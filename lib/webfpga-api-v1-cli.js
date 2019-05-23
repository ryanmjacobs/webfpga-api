const axios = require("axios");
const base  = "https://backend.webfpga.io/v1/api";

// disasble this on browser:
const WebSocket = require("ws");

// files is an array:
// [{name: "top.v", body: "module...."}]
module.exports.request_synthesis = async function(files, options={cache:true}) {
    const headers = {
        "X-WEBFPGA-CACHE": !!options.cache
    };

    const res = await axios.post(base + "/synthesize", {files}, {headers});
    return res.data;
}

module.exports.download_bitstream = async function(id) {
    const res = await axios.get(base + "/bitstream/" + id);
    return res.data;
}

// process_log is a function that takes a string,
//   e.g. function process_log(msg) { console.log(msg); }
module.exports.ws_subscribe = function(id, process_log) {
    const ws = new WebSocket("wss://backend.webfpga.io/v1/ws");

    ws.on("open", function() {
        const msg = {type: "subscribe", id};
        ws.send(JSON.stringify(msg));
    });

    return new Promise(resolve => {
        ws.on("message", data => {
            const msg = JSON.parse(data);
            if (msg.msg && msg.msg.includes("synthesis complete!")) {
                ws.close();
                resolve("done");
            }
            process_log(msg);
        });
    });
}
