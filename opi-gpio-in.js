// opi_in.js

const Gpio = require('onoff').Gpio;

module.exports = function (RED) {
    "use strict";

    function opiInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // --- Configuration Retrieval ---
        node.name = config.name;
        const pinValue = config.pin; // Raw pin value or variable name
        const pinType = config.pinType || 'num'; // Type ('num', 'env', etc.)
        const enableInterrupt = config.enableInterrupt; // Boolean: Enable interrupts?
        const edge = config.edge || 'both'; // Interrupt edge ('rising', 'falling', 'both')
        // Ensure debounce is a non-negative number
        let debounce = parseInt(config.debounce, 10);
        if (isNaN(debounce) || debounce < 0) {
            node.warn(`无效的去抖时间 "${config.debounce}"，已设置为 0。`);
            debounce = 0;
        }

        // --- Runtime Variables ---
        let monitoringPin = null; // Holds the Gpio object
        let actualPin;          // Holds the resolved numeric pin number
        let isInitialized = false;  // GPIO initialized flag
        let isWatching = false;     // Interrupt watch active flag

        node.log(`配置接收 - Pin Value: ${pinValue}, Pin Type: ${pinType}, Interrupt: ${enableInterrupt}, Edge: ${edge}, Debounce: ${debounce}`);

        // --- Pin Resolution and Initialization ---
        if (pinValue === null || pinValue === '') {
            node.warn("GPIO 引脚未配置。");
            node.status({ fill: "grey", shape: "ring", text: "未配置引脚" });
            return; // Stop if pin is not configured
        }

        RED.util.evaluateNodeProperty(pinValue, pinType, node, null, (err, resolvedValue) => {
            if (err) {
                node.error(`无法解析引脚配置 "${pinValue}" (类型: ${pinType}): ${err.message}`, {});
                node.status({ fill: "red", shape: "ring", text: "配置错误" });
                return;
            }

            node.log(`解析后引脚值: ${resolvedValue} (来自类型 ${pinType})`);
            actualPin = parseInt(resolvedValue, 10);

            if (isNaN(actualPin)) {
                node.error(`解析后的引脚值 "${resolvedValue}" 不是有效的数字。`, {});
                node.status({ fill: "red", shape: "ring", text: "引脚无效" });
                return;
            }

            // --- Attempt to Initialize GPIO ---
            try {
                node.log(`尝试初始化 GPIO 引脚 ${actualPin} (模式: in, 中断: ${enableInterrupt}, 边沿: ${edge}, 去抖: ${debounce})`);

                // Prepare options, only include debounce if > 0
                const gpioOptions = {};
                if (debounce > 0) {
                    gpioOptions.debounceTimeout = debounce;
                }
                // activeLow is another option, false by default

                // Initialize Gpio for input. If interrupts are enabled, pass edge and options.
                if (enableInterrupt) {
                    monitoringPin = new Gpio(actualPin, 'in', edge, gpioOptions);
                } else {
                    // If not using interrupts, no need to specify edge or debounce on init
                    monitoringPin = new Gpio(actualPin, 'in');
                }

                isInitialized = true;
                node.log(`GPIO 引脚 ${actualPin} 初始化成功。`);
                node.status({ fill: "grey", shape: "dot", text: `Pin ${actualPin} ready` });

                // --- Set up Interrupt Watch (if enabled and initialized) ---
                if (enableInterrupt) {
                    node.log(`尝试在引脚 ${actualPin} 上启动中断监听 (边沿: ${edge})...`);
                    try {
                        monitoringPin.watch((watchErr, value) => {
                            if (watchErr) {
                                // Error during watch callback (less common, might indicate underlying issues)
                                node.error(`引脚 ${actualPin} 中断回调错误: ${watchErr.message}`, {});
                                // Optionally update status to indicate watch issue
                                node.status({ fill: "yellow", shape: "ring", text: `Pin ${actualPin} (irq err)` });
                                return;
                            }
                            // Interrupt occurred successfully
                            const currentValue = Number(value);
                            node.log(`引脚 ${actualPin} 中断触发，值: ${currentValue}`);
                            node.send({ topic: `GPIO ${actualPin}`, payload: currentValue /*, interrupt: true */ }); // Sending interrupt:true might be redundant
                            node.status({ fill: "blue", shape: "dot", text: currentValue.toString() }); // Blue for interrupt
                            // Debounce is handled by 'onoff' if configured
                        });
                        isWatching = true; // Mark watch as active
                        node.log(`引脚 ${actualPin} 中断监听已成功启动。`);
                        // Update status to show watching is active, maybe read initial state?
                        try {
                            const initialState = monitoringPin.readSync();
                            node.status({ fill: "blue", shape: "dot", text: `Watching (${initialState})` });
                        } catch(readErr){
                            node.status({ fill: "blue", shape: "ring", text: `Watching (?)` });
                        }

                    } catch (watchSetupErr) {
                        // Error setting up the watch itself
                        isWatching = false;
                        node.error(`启动引脚 ${actualPin} 中断监听失败: ${watchSetupErr.message}. 可能此引脚不支持中断或存在权限问题。`, {});
                        node.status({ fill: "red", shape: "ring", text: "监听启动失败" });
                        // Node will still function for polling if isInitialized is true
                    }
                }

            } catch (initErr) {
                // Error during 'new Gpio()'
                node.error(`初始化 GPIO 引脚 ${actualPin} 失败: ${initErr.message}. 请检查引脚号、权限以及硬件兼容性。`, {});
                node.status({ fill: "red", shape: "ring", text: "初始化失败" });
                monitoringPin = null;
                isInitialized = false;
            }
        });

        // --- Handle Input Messages (for Polling) ---
        node.on('input', function (msg, send, done) {
            if (!isInitialized || !monitoringPin) {
                node.error("GPIO 未初始化，无法读取状态。", msg);
                node.status({ fill: "red", shape: "ring", text: "未初始化" });
                if (done) { done(); }
                return;
            }

            try {
                const currentValue = monitoringPin.readSync(); // Read current state synchronously
                const reading = Number(currentValue);
                node.log(`轮询读取引脚 ${actualPin} 状态: ${reading}`);
                node.send({ topic: `GPIO ${actualPin}`, payload: reading /*, interrupt: false */ }); // Send polled value
                // Update status only if not actively watching interrupts (or use a different color?)
                if (!isWatching) {
                    node.status({ fill: "green", shape: "dot", text: reading.toString() }); // Green for polled value
                } else {
                    // If watching, status is likely blue, maybe briefly flash green? Or just log.
                }
                if (done) { done(); } // Signal completion
            } catch (readErr) {
                node.error(`读取引脚 ${actualPin} 状态失败: ${readErr.message}`, msg);
                node.status({ fill: "red", shape: "dot", text: "读取失败" });
                if (done) { done(readErr); } // Signal completion with error
            }
        });

        // --- Handle Node Closure ---
        node.on('close', function (removed, done) {
            node.log(`节点关闭，尝试清理引脚 ${actualPin}`);
            if (monitoringPin) {
                // Stop watching first, if active
                if (isWatching) {
                    try {
                        monitoringPin.unwatch();
                        isWatching = false;
                        node.log(`引脚 ${actualPin} 中断监听已停止。`);
                    } catch (unwatchErr) {
                        node.error(`停止引脚 ${actualPin} 中断监听时出错: ${unwatchErr.message}`, {});
                        // Continue cleanup even if unwatch fails
                    }
                }
                // Then unexport the pin
                try {
                    monitoringPin.unexport();
                    node.log(`GPIO 引脚 ${actualPin} 已成功 unexport。`);
                } catch (unexportErr) {
                    node.error(`关闭 GPIO 引脚 ${actualPin} 时出错: ${unexportErr.message}`, {});
                }
            } else {
                node.log(`无需关闭 GPIO 引脚 ${actualPin} (未初始化)。`);
            }
            isInitialized = false;
            monitoringPin = null;
            node.status({}); // Clear status
            done(); // Signal cleanup complete
        });
    }

    // Register the node type with Node-RED
    RED.nodes.registerType("opi_in", opiInNode); // Ensure "opi_in" matches html and image path
}