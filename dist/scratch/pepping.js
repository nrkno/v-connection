"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const peptalk_1 = require("../peptalk");
const yargs = require("yargs");
let args = yargs
    .string('host')
    .number('port')
    .default('host', 'localhost')
    .default('port', 8595)
    .argv;
async function run() {
    let pt = peptalk_1.startPepTalk(args.host, args.port);
    try {
        await pt.get('/', 0);
    }
    catch (err) {
        console.error(err);
    }
    let connected = await pt.connect();
    console.log(connected);
    try {
        let start = process.hrtime();
        let pingResult = await pt.ping();
        let end = process.hrtime(start);
        console.log(end, pingResult);
    }
    catch (err) {
        console.error('!!!', err);
    }
    await pt.close();
    await pt.get('/', 0).catch(console.error);
}
run().catch(err => {
    console.error('General error', err);
});
//# sourceMappingURL=pepping.js.map