const Gpio = require('onoff').Gpio;

module.exports = function (RED) {
    "use strict";

    function opiOutNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        node.pin = config.pin;
        node.log("Pin: " + node.pin);
        node.set = config.set;
        node.level = config.level;
        let outpin;

        // init:
        if (node.pin !== '') {
            outpin = new Gpio(node.pin, 'out');
            outpin.unwatch();
        }

        if (node.set === true) {
            outpin.write(Number(node.level), function (err) {
                if (err) node.log("gpio.output.error");
            });
            node.status({fill: "green", shape: "dot", text: node.level.toString()});
        }

        this.on('input', function (msg) {
            outpin.write(Number(msg.payload), function (err) {
                if (err) node.log("gpio.output.error");
            });
            node.status({fill: "green", shape: "dot", text: msg.payload.toString()});
            if (RED.settings.verbose) {
                node.log("out: " + msg.payload);
            }
        });

        this.on('close', function () {
            outpin.unexport();
            node.log("close ");
        })
    }

    RED.nodes.registerType("opi_out", opiOutNode);
}
