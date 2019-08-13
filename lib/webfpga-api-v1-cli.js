const axios = require("axios");
const base  = "https://backend.webfpga.io/v1/api";

// files is an array:
// [{name: "top.v", body: "module...."}]
module.exports.request_synthesis = async function(files, options={cache:true}) {
    const headers = {
        "X-WEBFPGA-CACHE": !!options.cache
    };

    try {
      const res = await axios.post(base + "/synthesize", {files}, {headers});
      return res.data;
    } catch (e) {
      console.log(e, e.response);
      return e.response.data;
    }
}

module.exports.download_bitstream = async function(id) {
    const res = await axios.get(base + "/bitstream/" + id);
    return res.data;
}

// process_log is a function that takes a string,
//   e.g. function process_log(msg) { console.log(msg); }
module.exports.ws_subscribe = function(WebSocket, id, process_log) {
    const ws = new WebSocket("wss://backend.webfpga.io/v1/ws");

    ws.onopen = function() {
        const msg = {type: "subscribe", id};
        ws.send(JSON.stringify(msg));
    };

    return new Promise(resolve => {
        ws.onmessage = _data => {
            try {
                // native-browser WebSocket library
                var data = _data.data;
            } catch (e) {
                // Node.js ws library
                data = _data;
            }

            const msg = JSON.parse(data);
            if (msg.msg) {
                for (let m of msg.msg) {
                    if (m.includes("synthesis complete!")) {
                        ws.close();
                        resolve("done");
                    } else if (m.includes("synthesis failed")) {
                        ws.close();
                        resolve("failed");
                    }
                }
            }
            process_log(msg);
        };
    });
}
