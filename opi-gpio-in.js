const Gpio = require('onoff').Gpio;

module.exports = function (RED) {
    "use strict";

    function opiInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let monitoringPin;
        node.pin = config.pin;
        node.enableInterrupt = config.enableInterrupt;
        const options = {
            debounceTimeout: config.debounce || 0
        };

        function init() {
            try {
                monitoringPin = new Gpio(node.pin, 'in', config.edge, options);
            } catch (e) {
                //node.log(">>>> "+e);
                node.log(">>>> No interrupt available for this pin.");
                node.enableInterrupt = false;
                if (monitoringPin === undefined)
                    monitoringPin = new Gpio(node.pin, 'in', config.edge, options);
                //throw(e);
            }
            monitoringPin.unwatch();

            //Set up interrupt
            if (node.enableInterrupt === true) {
                monitoringPin.watch(function (err, value) {
                    if (err) node.log("gpio.input.error");
                    node.send({topic: "GPIO " + node.pin, payload: Number(value), interrupt: true});
                    node.buttonState = value;
                    node.status({fill: "green", shape: "dot", text: value});
                    if (RED.settings.verbose) {
                        node.log("out: " + value);
                    }
                });
            }
        }

        if (node.pin !== '') {
            init();
        }

        this.on('input', function (msg) {
            const reading = monitoringPin.readSync();
            node.send({topic: "GPIO " + node.pin, payload: Number(reading), interrupt: false});
            node.buttonState = reading;
            node.status({fill: "green", shape: "dot", text: reading});
            if (RED.settings.verbose) {
                node.log("out: " + reading);
            }
        })

        this.on('close', function () {
            node.log("close ");
            //if(node.enableInterrupt == 'true'){
            monitoringPin.unwatch();
            //}
            monitoringPin.unexport();
        })
    }

    RED.nodes.registerType("opi_in", opiInNode);
}