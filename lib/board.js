class Board {
    constructor(options={}) {
        this.device = null;
        this.VERIFY_STR = null;

        this.usb  = options.usb;
        this.log  = options.log_method || console.log;
        this.set_device_info = options.set_device_info || console.log;

        // AT Command Lookup Table
        this.CMD_LUT = {
            "AT":   1,  "API":  3,  "APR":  4,  "APWE": 11, "APFU": 15, "AVML": 19,
            "AMQ":  20, "AMW":  24, "AMR":  25, "AME":  27, "AMBE": 28, "AMWD": 29,
            "AFPA0": 30
        };

        if (!this.usb) {
            console.error("error: browser does not support WebUSB");
            console.error("       (or you did not properly pass in options.usb)");
        }
    }

    // Connect to a given device and set this.device properly.
    async connect_device(dev) {
        await dev.open();

        if (dev.configuration === null) {
            await dev.selectConfiguration(1).catch(error => {
                this.log(error + "\n");
            });
        }

        this.device = dev;
        this.log("Connected to board.\n");
        this.log(dev.productName + " - " + dev.manufacturerName + "\n");
        this.set_device_info({
            main: "Connected to Shasta+",
            specs: [
                "5,511 Logic Cells",
                "16 MHz",
                "32 GPIOs",
                "4 inter-MCU IOs"
            ]
        });
    }

    // We run this function when the user clicks the "connect" button.
    // This function will enumerate all devices and check for our valid
    // vendor signature. After a valid device is found, we call
    // connect_device() on it.
    enumerate_devices() {
        const filters = {filters: [
            {vendorId: 0x1209},
            {vendorId: 0x16D0},
            {vendorId: 0x0483} // STMicro
        ]};

        if (!this.usb) {
            this.log("error: WebUSB not supported\n", "red");
            return;
        }

        return this.usb.requestDevice(filters)
          .then(dev => this.connect_device(dev))
          .catch(error => {
              this.log(error + "\n Check device type, or another page is connected to the device.\n");
          });
    }

    // This function sends a command to the USB device and returns a promise
    // for the data response.
    async send_cmd(cmd, options={}) {
        const data = options.data;
        const textDecode = (options.textDecode !== undefined ? !!options.textDecode : true);
        const sleepOverride = (parseInt(options.sleepOverride) || 10);
        const cmdIndex = (parseInt(options.cmdIndex) || 0);

        if (!this.device || !this.device.opened) {
            this.log("error: device not connected.\n", "red");
            this.log("Use button to connect to a supported programmer.\n", "red");
            return Promise.reject("error: device not opened");
        }

        const opts = {
            requestType: "vendor",
            recipient: "device",
            request: 250,
            value: this.CMD_LUT[cmd],
            index: cmdIndex
        };

        // transfer data out
        const res = data
          ? await this.device.controlTransferOut(opts, data)
          : await this.device.controlTransferOut(opts);

        // sleep for a bit to give the USB device some processing time leeway
        await (() => new Promise(resolve => setTimeout(resolve, sleepOverride)))();

        return this.device.controlTransferIn({
            requestType: "vendor",
            recipient: "device",
            request: 249,
            value: 0x70,
            index: 0x81
        }, 64).then(result => {
            return textDecode
              ? (new TextDecoder()).decode(result.data)
              : result.data.buffer;
        });
    }

    // Verifies that an AT command returns an expected response.
    // FIXME: not sure what "index" does -- Ryan
    async at_verify(cmd, expected, index) {
        const opts = /AMQ|AMBE/.test(cmd) ? {sleepOverride: 10, cmdIndex: index} : {cmdIndex: index};

        await this.send_cmd(cmd, opts).then(result => {
            this.VERIFY_STR = result.split("\n")[0];

            const err = (typeof expected == "string")
                ? (this.VERIFY_STR != expected)
                : !expected.test(this.VERIFY_STR);

            if (err) {
                this.log(`--RECV ${cmd}: ${this.VERIFY_STR} != ${expected} (fail)\n`, "red");
                return Promise.reject();
            } else {
                this.log(`--RECV ${cmd}: ${this.VERIFY_STR} (pass)\n`, "green");
                return Promise.resolve();
            }
        });
    }

    // Toggle a CPU pin. Valid port/bit configurations are:
    // Port A - Bit 0
    // Port A - Bit 2
    // Port A - Bit 3
    // Port B - Bit 1
    async toggle_cpu_pin(port, bit) {
        try {
            this.log(`Toggling Programmer Port ${port} bit ${bit}...\n`, "blue");
            await this.at_verify("AFPA0", "Done", bit);
            this.log(`P${port}${bit} was toggled.\n`, "blue");
        } catch (e) {
            this.log("error: failed to toggle bit.\n", "red");
            console.error(e);
        }
    }

    async program(cbin) {
        try {
            this.log("\n\nFinding and checking for programmer...\n", "blue");
            await this.at_verify("AT", "Hi");
            await this.at_verify("API", /C_WEBUSB|CWEBUSB+/);
            await this.at_verify("APR", /00092(0|1|2|3)/);
            this.log("Found programmer.\n", "blue");
        } catch (e) {
            this.log("error: board failed verification\n", "red");
            console.error(e);
            return;
        }

        try {
            this.log("Checking for FPGA module and its flash configuration...\n", "blue");
            await this.at_verify("APWE", "wren");
            await this.at_verify("AMQ", /.*/);

            if (this.VERIFY_STR.length != 9) throw "Bad AMQ response, length bad.";
            if (this.VERIFY_STR[0] != "S")   throw "Flash device not supported.";
            if (this.VERIFY_STR[6] != "H")   throw "Flash device has bad Cascadia header.";

            // erase sectors needed for fpga image
            await this.at_verify("AMBE", "DONE");
            await this.at_verify("AMQ", /.*/);

            // for our board type
            if (this.VERIFY_STR.length != 9) throw "Bad AMQ response, length bad.";
            if (this.VERIFY_STR[0] != "S")   throw "Flash device not supported.";
            if (this.VERIFY_STR[5] != "W")   throw "Flash device is write protected.";
            if (this.VERIFY_STR[6] != "H")   throw "Flash device has bad Cascadia header.";
            if (this.VERIFY_STR[8] != "E")   throw "Flash device is not erased.";

            // flash
            this.log("\nflashing module...\n", "blue");
            await this.flash(cbin);
            this.log("\nDone.\n", "blue");
        } catch (e) {
            this.log("error: " + e + "\n");
            this.log("error: failed to flash board\n", "red");
            console.error(e);
        }
    }

    async flash(cbin) {
        try {
            await this.at_verify("AMW", "OK");

            let idx = 0;
            while (idx < cbin.length) {
                // retrieve block
                const len = cbin[idx];
                const block = cbin.slice(idx, idx+len);
                idx += len;

                // write block
                const res = await this.send_cmd("AMWD", {data: block});
                const str = res.split("\n")[0];
                this.log(".", "blue", true);
                /*this.log(`--RECV AMWD: ${str}\n`, "blue");*/
            }
        } catch (e) {
            console.error(e);
        }
    }
}

module.exports = Board;
