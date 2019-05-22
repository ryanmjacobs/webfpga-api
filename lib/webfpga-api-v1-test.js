#!/usr/bin/env node
const webfpga_api = require("./webfpga-api-v1-cli");
const chalk = require("chalk");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async function() {
    const res = await webfpga_api.request_synthesis([
        {name: "top.v", body: "module fpga_top;\nendmodule//" + Math.random()}
    ]);

    const log_msg = function(o) {
        if (o.msg) {
            // synthesis-log messages
            for (let msg of o.msg) {
                // colorize coded messages
                if (msg.startsWith("#*")) {
                    color = msg.split(" ")[0].slice(2).toLowerCase();
                    str   = msg.split(" ").slice(1).join(" ");
                    console.log(chalk.keyword(color)(str));
                } else {
                    // default black/white printing
                    console.log(msg);
                }
            }
        // initial subscribe string
        } else if (o.type == "subscribe") {
            console.log("Subscribed to stream: " + o.id);
        }
    }

    // depending on cache status, decided whether to trace the log,
    // or just immediately print the bitstream object
    if (res.cached) {
        const bit = await webfpga_api.download_bitstream(res.id);
        console.log(bit);
    } else {
        await webfpga_api.ws_subscribe(res.id, log_msg);
        const bit = await webfpga_api.download_bitstream(res.id);
        console.log(bit);
    }
})();
