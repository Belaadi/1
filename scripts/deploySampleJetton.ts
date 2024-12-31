import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from '../utils/jetton-helpers';
import fs from 'fs';
import * as Path from 'node:path';
import * as child_process from 'node:child_process';
import * as readline from 'readline';
import { stdin as input, stdout as output } from 'node:process';


const rl = readline.createInterface({ input, output });

rl.once('SIGINT',console.log)
rl.on('line',console.log)

const askQuestion = (question: string) => {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer+"");
        });
    });
};

const dataPath = Path.join(process.cwd(),'data');
const metadataPath = Path.join(dataPath,'metadata.json');


if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, {
        recursive: true
    });
}

const requiredKey = ['name','description','symbol', 'image'] as const;
let data: Partial<{
    name: string,
    description: string,
    symbol: string,
    image: string,
}> = {};

try {
    data = JSON.parse(fs.readFileSync(metadataPath).toString('utf8'));
} catch {}

async function prompt(msg: string): Promise<string> {
    return (await askQuestion(msg+"\n"))+"";
}

export async function run(provider: NetworkProvider) {
    input.resume();
    input.setEncoding('utf8');

    console.log("Validating Token Metadata...");
    for (let key of requiredKey) {
        if (!data[key]) {
            data[key] = await prompt(`Enter ${key}`);
        }
    }
    await fs.promises.writeFile(metadataPath, JSON.stringify(data, null, 2)).catch((e)=>{
        console.warn('Fail to save metadata',e);
    });
    console.log("Validation done.");

    let deployed = false;
    if (!fs.existsSync(Path.join(process.cwd(),'build'))) {
        console.log("Building Tact Files...");
        await new Promise(r=>{
            child_process.exec("npm run build",e => {
                console.log(e?.message);
                r(true);
            });
        })
        console.log("Build Successful");
        console.warn("Please restart project to apply changes");
        console.info('Enter command this command to deploy token:\nnpm run start');
        process.exit(0);
    } else {
        deployed = fs.existsSync(Path.join(process.cwd(),'build/deployed'));
    }

    //@ts-ignore
    const [{SampleJetton},{JettonDefaultWallet} ] = await Promise.all([
        import(`../wrappers/SampleJetton`),
        //@ts-ignore
        import(`../build/SampleJetton/tact_JettonDefaultWallet`)
    ] as const)

    // Create content Cell
    let content = buildOnchainMetadata(data as Required<typeof data>);
    const address = provider.sender().address as Address;
    const sampleJetton = provider.open(
        await SampleJetton.fromInit(address, content, 1000000000000000000n),
    );

    if (!deployed) {
        console.log('Deployed and Mint...', address.toString());
        await sampleJetton.send(
            provider.sender(),
            {
                value: toNano('0.05'),
                bounce: true,
            },
            {
                $$type: 'Mint',
                amount: 50000000000000n,
                receiver: address,
            },
        );
        await provider.waitForDeploy(sampleJetton.address);
        await fs.promises.writeFile(Path.join(process.cwd(),'build/deployed'),"true").catch(()=>{
            console.log("Looks like the app doesn't access to files");
        });
    }

    async function circle() {
        const input = await prompt(`${data.symbol} 
Enter number to continue:

1. Mint 50K ${data.symbol} (give yourself token)
2. Add Wallet Address to whitelist
3. Remove Wallet Address From whitelist
4. Change Token Metadata (symbol,image,...)
5. Delete build data
0. Exit`);

        switch (input) {
            case "1":
                await sampleJetton.send(
                    provider.sender(),
                    {
                        value: toNano('0.05'),
                        bounce: true,
                    },
                    {
                        $$type: 'Mint',
                        amount: 50000000000000n,
                        receiver: address,
                    },
                );
                break;
            case "2":
            case "3":
                const target = Address.parse(await prompt("Enter wallet address")+"");
                const jettonWalletAddress = await sampleJetton.getGetWalletAddress(target);

                console.log(jettonWalletAddress.toString({bounceable: false}));
                console.log('Jetton wallet address:', jettonWalletAddress.toString());

                // Open the jetton wallet contract
                const jettonWallet = provider.open(JettonDefaultWallet.fromAddress(jettonWalletAddress));

                await jettonWallet.send(
                    provider.sender(),
                    {
                        value: toNano('0.05'), // Attach some TON for gas
                        bounce: true,
                    },
                    {
                        $$type: 'ChangeCan',
                        can: input === "2"
                    },
                );

                break;
            case "4":
                if (!(await prompt("this operation delete current token and make another one. continue? (yes/no)\n")+"").startsWith("y")) break;

                await fs.promises.rm(metadataPath).catch(console.error);
                break;
            case "5":
                const inp = await prompt("this operation delete current token and make another one.\ncontinue? (yes/no)\n\n")+"";
                console.log("INPUT",inp);
                if (!inp.toLowerCase().startsWith("y")) break;

                console.log("Deleting build data...");
                await fs.promises.rm(metadataPath, {
                    recursive: true
                }).catch(console.error);
                await fs.promises.rm(Path.join(process.cwd(),'build'), {
                    recursive: true
                });
            case "0":
                console.log("EXIT");
                process.exit(0);
                break;
            default:
                console.log("Invalid command");
                break;
        }
        console.log("Operation done");
        circle().catch(console.error);
    }

    do {
        console.log("Start Circle");
        await circle().catch((e)=>{
            console.error("Circle Error",e);
        });
    } while(true);
}
