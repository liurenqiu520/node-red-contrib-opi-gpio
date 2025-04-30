// opi_out.js

// Import the GPIO library
// Make sure 'onoff' is installed (npm install onoff) and compatible with your hardware
const Gpio = require('onoff').Gpio;

module.exports = function (RED) {
    "use strict";

    // The main function for the output node
    function opiOutNode(config) {
        // Create the Node-RED node instance
        RED.nodes.createNode(this, config);
        const node = this; // Keep a reference to the node object

        // --- Configuration Retrieval ---
        // Get properties from the node's configuration in the editor
        node.name = config.name;
        const pinValue = config.pin; // The raw value/variable name from config
        const pinType = config.pinType || 'num'; // The type ('num', 'env', etc.), default to 'num' if undefined
        const initialSet = config.set; // Boolean: whether to set initial state
        const initialLevel = config.level; // String: "0" or "1" for initial level

        // --- Runtime Variables ---
        let outpin = null; // Variable to hold the Gpio object, initially null
        let actualPin;   // Variable to hold the resolved, numeric pin number
        let isInitialized = false; // Flag to track if GPIO is successfully initialized

        node.log(`Configuration received - Pin Value: ${pinValue}, Pin Type: ${pinType}, Initial Set: ${initialSet}, Initial Level: ${initialLevel}`);

        // --- GPIO Initialization Logic ---
        // Check if a pin value was provided in the configuration
        if (pinValue === null || pinValue === '') {
            node.warn("GPIO 引脚未配置。");
            node.status({ fill: "grey", shape: "ring", text: "未配置引脚" });
            return; // Stop initialization if pin is not configured
        }

        // Use Node-RED utility to resolve the pin value based on its type
        // This handles numbers, strings, environment variables, flow/global context etc.
        RED.util.evaluateNodeProperty(pinValue, pinType, node, null, (err, resolvedValue) => {
            if (err) {
                // Error during evaluation (e.g., env var not found)
                node.error(`无法解析引脚配置 "${pinValue}" (类型: ${pinType}): ${err.message}`, {});
                node.status({ fill: "red", shape: "ring", text: "配置错误" });
                return; // Stop initialization
            }

            node.log(`Resolved pin value: ${resolvedValue} (from type ${pinType})`);

            // Try to convert the resolved value to an integer
            actualPin = parseInt(resolvedValue, 10);

            // Check if conversion was successful and it's a valid number
            if (isNaN(actualPin)) {
                node.error(`解析后的引脚值 "${resolvedValue}" 不是有效的数字。`, {});
                node.status({ fill: "red", shape: "ring", text: "引脚无效" });
                return; // Stop initialization
            }

            // --- Attempt to Initialize GPIO ---
            try {
                node.log(`尝试初始化 GPIO 引脚: ${actualPin}`);
                // Create a new Gpio object for output
                outpin = new Gpio(actualPin, 'out');
                isInitialized = true; // Mark as successfully initialized
                node.log(`GPIO 引脚 ${actualPin} 初始化成功。`);

                // --- Set Initial State (if configured and GPIO initialized successfully) ---
                if (initialSet) {
                    const levelToSet = Number(initialLevel); // Convert "0" or "1" to number
                    if (!isNaN(levelToSet)) {
                        node.log(`设置初始电平 ${levelToSet} 到引脚 ${actualPin}`);
                        // Write the initial level
                        outpin.write(levelToSet, (writeErr) => { // Use async write with callback
                            if (writeErr) {
                                node.error(`设置初始电平 ${levelToSet} 到引脚 ${actualPin} 失败: ${writeErr.message}`, {});
                                // Keep status grey, as init succeeded but initial write failed
                                node.status({ fill: "yellow", shape: "dot", text: `Pin ${actualPin} (写入错误)` });
                            } else {
                                node.log(`初始电平 ${levelToSet} 设置成功。`);
                                node.status({ fill: "green", shape: "dot", text: levelToSet.toString() }); // Show initial state
                            }
                        });
                    } else {
                        node.warn(`配置的初始电平 "${initialLevel}" 不是有效数字 (0 或 1)。`);
                        node.status({ fill: "grey", shape: "dot", text: `Pin ${actualPin}` }); // Default ready status
                    }
                } else {
                    // No initial state setting needed, show default ready status
                    node.status({ fill: "grey", shape: "dot", text: `Pin ${actualPin}` });
                }

            } catch (initErr) {
                // Error during 'new Gpio()' or initial write
                node.error(`初始化 GPIO 引脚 ${actualPin} 失败: ${initErr.message}`, {});
                node.status({ fill: "red", shape: "ring", text: "初始化失败" });
                outpin = null; // Ensure outpin remains null if initialization failed
                isInitialized = false;
            }
        });


        // --- Handle Input Messages ---
        node.on('input', function (msg, send, done) {
            // 'send' and 'done' are for Node-RED 1.0+ compatibility

            // Check if GPIO was initialized successfully
            if (!isInitialized || !outpin) {
                node.error("GPIO 未初始化或初始化失败，无法写入。", msg);
                node.status({ fill: "red", shape: "ring", text: "未初始化" });
                if (done) { done(); } // Signal completion (with error state implied)
                return;
            }

            // Get the value to write from msg.payload, convert to number (expect 0 or 1)
            const payloadLevel = Number(msg.payload);

            // Validate the payload
            if (isNaN(payloadLevel) || (payloadLevel !== 0 && payloadLevel !== 1)) {
                node.warn(`接收到的 payload "${msg.payload}" 不是有效的数字 (0 或 1)，已忽略。`, msg);
                if (done) { done(); } // Signal completion
                return;
            }

            // Write the value to the GPIO pin
            try {
                // Using asynchronous write is generally recommended
                outpin.write(payloadLevel, (writeErr) => {
                    if (writeErr) {
                        node.error(`写入 ${payloadLevel} 到引脚 ${actualPin} 失败: ${writeErr.message}`, msg);
                        node.status({ fill: "red", shape: "dot", text: "写入失败" });
                    } else {
                        // Success
                        node.status({ fill: "green", shape: "dot", text: payloadLevel.toString() });
                        if (RED.settings.verbose) { // Log only if verbose logging is enabled
                            node.log(`写入: ${payloadLevel} 到引脚 ${actualPin}`);
                        }
                        // You could optionally pass the message on using send(msg) here if needed
                    }
                    // Signal completion *after* async operation finishes (or fails)
                    if (done) { done(writeErr); }
                });
            } catch (syncWriteErr) {
                // Catch potential synchronous errors from write, though less common with onoff async
                node.error(`调用写入 ${payloadLevel} 到引脚 ${actualPin} 时出错: ${syncWriteErr.message}`, msg);
                node.status({ fill: "red", shape: "dot", text: "写入错误" });
                if (done) { done(syncWriteErr); }
            }
        });

        // --- Handle Node Closure ---
        node.on('close', function (removed, done) {
            node.log(`节点关闭，尝试清理引脚 ${actualPin}`);
            // Check if the GPIO pin was successfully initialized before trying to unexport
            if (outpin) {
                try {
                    outpin.unexport(); // Release the GPIO pin
                    node.log(`GPIO 引脚 ${actualPin} 已成功 unexport。`);
                    isInitialized = false;
                    outpin = null;
                } catch (unexportErr) {
                    // Log error if unexporting fails, but don't prevent closure
                    node.error(`关闭 GPIO 引脚 ${actualPin} 时出错: ${unexportErr.message}`, {});
                }
            } else {
                node.log(`无需关闭 GPIO 引脚 ${actualPin} (未初始化)。`);
            }
            node.status({}); // Clear node status on close
            done(); // Signal that cleanup is complete
        });
    }

    // Register the node type with Node-RED
    RED.nodes.registerType("opi_out", opiOutNode); // Ensure "opi_out" matches the html file and image path
}