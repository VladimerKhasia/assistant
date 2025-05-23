document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('input');
    const output = document.getElementById('output');
    const submit = document.getElementById('submit');
    const systemPromptInput = document.getElementById('systemPrompt');
    const temperatureInput = document.getElementById('temperature');
    const topKInput = document.getElementById('topK');
    const modelIdInput = document.getElementById('modelId');
    const datatypeInput = document.getElementById('datatype');
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsModal = document.getElementById('settings-modal');
    const closeModal = document.getElementById('close-modal');
    const saveSettings = document.getElementById('save-settings');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    // Verify critical DOM elements
    if (!output || !input || !submit || !progressContainer || !progressBar || !progressText) {
        console.error('Critical DOM elements missing:', { output, input, submit, progressContainer, progressBar, progressText });
        alert('Error: Page elements not found. Please refresh the page.');
        return;
    }

    let conversationHistory = [];
    let uiConversationHistory = [];
    let worker;
    let currentSettings = {
        systemPrompt: systemPromptInput.value.trim(),
        temperature: parseFloat(temperatureInput.value),
        topK: parseInt(topKInput.value),
        modelId: modelIdInput.value.trim(),
        datatype: datatypeInput.value.trim()
    };

    console.log('Initial settings:', currentSettings);

    // Configure marked.js for better Markdown handling
    marked.setOptions({
        breaks: true,
        gfm: true,
        mangle: false,
        headerIds: false
    });

    /**
     * Register service worker for PWA
     */
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('Service Worker registered with scope:', registration.scope);
                    // Check for updates to ensure latest service worker is active
                    registration.update();
                })
                .catch(error => {
                    console.error('Service Worker registration failed:', error);
                });
        });
    }

    /**
     * Render the full UI conversation history as HTML with Markdown
     */
    function renderConversation() {
        if (!output) {
            console.error('Output element is undefined');
            return;
        }
        output.innerHTML = '';
        uiConversationHistory.forEach(turn => {
            const div = document.createElement('div');
            div.className = turn.type === 'user' ? 'user-message' : 'model-message';
            const prefix = turn.type === 'user' ? 'You: ' : 'Assistant: ';
            let content = turn.type === 'user' ? turn.content : marked.parse(turn.content);
            div.innerHTML = `<strong>${prefix}</strong>${content}`;
            output.appendChild(div);
        });
        output.scrollTop = output.scrollHeight;
    }

    /**
     * Modal handling functions
     */
    function openModal() {
        if (settingsModal) {
            settingsModal.style.display = 'block';
        }
    }

    function closeModalFunc() {
        if (settingsModal) {
            settingsModal.style.display = 'none';
        }
    }

    /**
     * Check if the app is offline
     */
    function isOffline() {
        return !navigator.onLine;
    }

    /**
     * Initialize the Web Worker with retry logic and cache busting
     */
    async function initializeWorker(retries = 3, delay = 2000) {
        // Check if offline and adjust UI
        if (isOffline()) {
            requestAnimationFrame(() => {
                if (progressContainer && progressBar && progressText) {
                    progressContainer.style.display = 'block';
                    progressBar.style.width = '0%';
                    progressText.textContent = 'Offline: Attempting to load cached model...';
                }
                if (output) {
                    output.innerHTML = '<div class="info-message">Offline mode: Loading cached model...</div>';
                }
            });
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            console.log(`Main: Initializing worker (attempt ${attempt}/${retries})`);
            try {
                worker = new Worker(`/worker.js?t=${Date.now()}`, { type: 'module' });
                worker.onmessage = (e) => {
                    console.log('Main: Worker message:', e.data);
                    const { status, data, output: workerOutput, progress } = e.data;

                    if (status === 'webgpu_supported') {
                        if (output) {
                            output.innerHTML = `<div class="info-message">WebGPU supported: ${data || 'GPU Adapter'}. Loading model...</div>`;
                        }
                        requestAnimationFrame(() => {
                            if (progressContainer && progressBar && progressText) {
                                progressContainer.style.display = 'block';
                                progressBar.style.width = '0%';
                                progressText.textContent = 'Checking WebGPU...';
                            }
                        });
                        worker.postMessage({ 
                            type: 'load',
                            data: {
                                modelId: currentSettings.modelId,
                                datatype: currentSettings.datatype
                            }
                        });
                    } else if (status === 'error') {
                        if (output) {
                            output.innerHTML = `<div class="error-message">Error: ${data}</div>`;
                        }
                        requestAnimationFrame(() => {
                            if (progressContainer && progressBar && progressText) {
                                progressContainer.style.display = 'block';
                                progressBar.style.width = '0%';
                                progressText.textContent = `Error: ${data}`;
                            }
                        });
                        if (submit) {
                            submit.disabled = true;
                            submit.textContent = 'Error Occurred';
                        }
                        alert(`Failed to initialize: ${data}`);
                    } else if (status === 'progress') {
                        console.log('Main: Progress update received:', progress);
                        requestAnimationFrame(() => {
                            if (progress && progress.loaded !== undefined && progress.total) {
                                const percent = Math.min((progress.loaded / progress.total) * 100, 100).toFixed(1);
                                if (progressBar) {
                                    progressBar.style.width = `${percent}%`;
                                }
                                if (progressText) {
                                    progressText.textContent = `Loading ${progress.file || 'model'}: ${percent}%`;
                                }
                            } else {
                                if (progressBar) {
                                    progressBar.style.width = '5%';
                                }
                                if (progressText) {
                                    progressText.textContent = `Initializing ${progress.file || 'model'}...`;
                                }
                            }
                            if (progressContainer) {
                                progressContainer.style.display = 'block';
                            }
                        });
                    } else if (status === 'loading') {
                        if (output) {
                            output.innerHTML = `<div class="info-message">${data}</div>`;
                        }
                        requestAnimationFrame(() => {
                            if (progressContainer && progressBar && progressText) {
                                progressContainer.style.display = 'block';
                                progressBar.style.width = '0%';
                                progressText.textContent = data;
                            }
                        });
                    } else if (status === 'ready') {
                        if (submit) {
                            submit.disabled = false;
                            submit.textContent = 'Get Response';
                        }
                        requestAnimationFrame(() => {
                            if (progressContainer && progressBar && progressText) {
                                progressContainer.style.display = 'block';
                                progressBar.style.width = '100%';
                                progressText.textContent = 'Model loaded successfully';
                            }
                        });
                        if (output) {
                            output.innerHTML = '<div class="info-message">Model loaded successfully. Enter a query to get started.</div>';
                        }
                    } else if (status === 'start') {
                        uiConversationHistory.push({ type: 'model', content: '', complete: false });
                        renderConversation();
                    } else if (status === 'update') {
                        const lastTurn = uiConversationHistory[uiConversationHistory.length - 1];
                        lastTurn.content = (lastTurn.content || '') + workerOutput;
                        renderConversation();
                    } else if (status === 'complete') {
                        const lastTurn = uiConversationHistory[uiConversationHistory.length - 1];
                        lastTurn.content = workerOutput[0];
                        lastTurn.complete = true;
                        conversationHistory.push({ role: 'assistant', content: workerOutput[0] });
                        if (conversationHistory.length > 10) {
                            conversationHistory = conversationHistory.slice(-10);
                            uiConversationHistory = uiConversationHistory.slice(-10);
                        }
                        renderConversation();
                        if (submit) {
                            submit.disabled = false;
                            submit.textContent = 'Get Response';
                        }
                    }
                };

                worker.onerror = (error) => {
                    console.error('Main: Worker error:', error);
                    const errorDetails = error.message || error.toString() || 'Unknown worker error';
                    if (output) {
                        output.innerHTML = `<div class="error-message">Worker error: ${errorDetails}</div>`;
                    }
                    requestAnimationFrame(() => {
                        if (progressContainer && progressBar && progressText) {
                            progressContainer.style.display = 'block';
                            progressBar.style.width = '0%';
                            progressText.textContent = `Worker error: ${errorDetails}`;
                        }
                    });
                    if (submit) {
                        submit.disabled = true;
                        submit.textContent = 'Error Occurred';
                    }
                    // Ensure Save Settings remains responsive
                    if (saveSettings) {
                        saveSettings.disabled = false;
                        saveSettings.textContent = 'Save Settings';
                    }
                };

                worker.postMessage({ type: 'check' });
                return; // Success
            } catch (error) {
                console.error(`Main: Worker initialization failed (attempt ${attempt}):`, error);
                if (attempt === retries) {
                    if (output) {
                        output.innerHTML = `<div class="error-message">Failed to initialize worker after ${retries} attempts: ${error.message}</div>`;
                    }
                    requestAnimationFrame(() => {
                        if (progressContainer && progressBar && progressText) {
                            progressContainer.style.display = 'block';
                            progressBar.style.width = '0%';
                            progressText.textContent = `Error: ${error.message}`;
                        }
                    });
                    if (submit) {
                        submit.disabled = true;
                        submit.textContent = 'Initialization Failed';
                    }
                    // Ensure Save Settings remains responsive
                    if (saveSettings) {
                        saveSettings.disabled = false;
                        saveSettings.textContent = 'Save Settings';
                    }
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * Validate and save settings
     */
    async function saveSettingsFunc() {
        console.log('Save Settings button clicked or Enter pressed');
        const newSystemPrompt = systemPromptInput.value.trim() || 'You are a helpful assistant.';
        const newTemperature = parseFloat(temperatureInput.value);
        const newTopK = parseInt(topKInput.value);
        const newModelId = modelIdInput.value.trim();
        const newDatatype = datatypeInput.value.trim();

        // Validate inputs
        if (isNaN(newTemperature) || newTemperature < 0 || newTemperature > 1) {
            alert('Temperature must be between 0.0 and 1.0');
            return;
        }
        if (isNaN(newTopK) || newTopK < 1 || newTopK > 100) {
            alert('Top-K must be between 1 and 100');
            return;
        }
        if (!newModelId) {
            alert('Model ID cannot be empty');
            return;
        }
        if (!newDatatype) {
            alert('Datatype cannot be empty');
            return;
        }

        if (saveSettings) {
            saveSettings.disabled = true;
            saveSettings.textContent = 'Saving...';
        }
        if (submit) {
            submit.disabled = true;
            submit.textContent = 'Processing...';
        }

        currentSettings = {
            systemPrompt: newSystemPrompt,
            temperature: newTemperature,
            topK: newTopK,
            modelId: newModelId,
            datatype: newDatatype
        };
        console.log('New settings applied:', currentSettings);

        try {
            // Clear history
            conversationHistory = [];
            uiConversationHistory = [];
            if (output) {
                output.innerHTML = '';
            }

            // Reset and initialize worker
            if (worker) {
                worker.postMessage({ type: 'reset' });
                worker.terminate();
            }
            requestAnimationFrame(() => {
                if (progressContainer && progressBar && progressText) {
                    progressContainer.style.display = 'block';
                    progressBar.style.width = '0%';
                    progressText.textContent = 'Initializing worker...';
                }
            });
            await initializeWorker();
            alert('Settings updated and model loading initiated.');
        } catch (error) {
            console.error('Failed to initialize worker:', error);
            if (output) {
                output.innerHTML = `<div class="error-message">Failed to initialize: ${error.message}</div>`;
            }
            requestAnimationFrame(() => {
                if (progressContainer && progressBar && progressText) {
                    progressContainer.style.display = 'block';
                    progressBar.style.width = '0%';
                    progressText.textContent = `Error: ${error.message}`;
                }
            });
            if (submit) {
                submit.textContent = 'Initialization Failed';
                submit.disabled = true;
            }
            if (saveSettings) {
                saveSettings.disabled = false;
                saveSettings.textContent = 'Save Settings';
            }
            return;
        }

        if (saveSettings) {
            saveSettings.disabled = false;
            saveSettings.textContent = 'Save Settings';
        }
        closeModalFunc();
    }

    /**
     * Initialize UI and eventListeners
     */
    function initializeApp() {
        if (settingsToggle) {
            settingsToggle.addEventListener('click', openModal);
        }
        if (closeModal) {
            closeModal.addEventListener('click', closeModalFunc);
        }
        if (saveSettings) {
            saveSettings.addEventListener('click', saveSettingsFunc);
        }
        window.addEventListener('click', (event) => {
            if (event.target === settingsModal) {
                closeModalFunc();
            }
        });

        // Add Enter key support for settings modal
        if (settingsModal) {
            settingsModal.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
                    event.preventDefault();
                    if (saveSettings && !saveSettings.disabled) {
                        console.log('Enter key pressed in settings modal, triggering save');
                        saveSettingsFunc();
                    }
                }
            });
        }

        if (submit) {
            submit.onclick = async () => {
                const userInput = input.value.trim();
                input.value = '';
                if (!userInput) {
                    if (output) {
                        output.innerHTML = '<div class="error-message">Please enter a query.</div>';
                    }
                    input.focus();
                    return;
                }

                submit.disabled = true;
                submit.textContent = 'Generating...';

                conversationHistory.push({ role: 'user', content: userInput });
                uiConversationHistory.push({ type: 'user', content: userInput, complete: true });

                if (conversationHistory.length > 10) {
                    conversationHistory = conversationHistory.slice(-10);
                    uiConversationHistory = uiConversationHistory.slice(-10);
                }

                renderConversation();

                try {
                    const messages = [
                        { role: 'system', content: currentSettings.systemPrompt },
                        ...conversationHistory
                    ];
                    if (worker) {
                        worker.postMessage({
                            type: 'generate',
                            data: {
                                messages,
                                temperature: currentSettings.temperature,
                                topK: currentSettings.topK
                            }
                        });
                    }
                } catch (error) {
                    console.error('Response generation failed:', error);
                    uiConversationHistory.push({
                        type: 'model',
                        content: `Error generating response: ${error.message}. Please try again.`,
                        complete: true
                    });
                    renderConversation();
                    if (submit) {
                        submit.disabled = false;
                        submit.textContent = 'Get Response';
                    }
                }
            };
        }

        if (input) {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
                    event.preventDefault();
                    if (submit && !submit.disabled) {
                        console.log('Enter key pressed in input, triggering submit');
                        submit.click();
                    }
                }
            });
        }

        // Initial UI state
        requestAnimationFrame(() => {
            if (submit) {
                submit.disabled = true;
                submit.textContent = 'Configure Settings';
            }
            if (output) {
                output.innerHTML = '<div class="info-message">Please open settings to configure and load the model.</div>';
            }
            if (progressContainer && progressBar && progressText) {
                progressContainer.style.display = 'block';
                progressBar.style.width = '0%';
                progressText.textContent = 'Model not loaded';
            }
        });

        // Initialize worker to ensure app responsiveness
        initializeWorker().catch(error => {
            console.error('Initial worker initialization failed:', error);
            if (isOffline()) {
                alert('Offline: Failed to load cached model. Please connect to the internet to cache the model files.');
            } else {
                alert('Failed to start the app. Please check your internet connection or browser compatibility.');
            }
        });
    }

    // Start the app
    initializeApp();
});