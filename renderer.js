const { ipcRenderer } = require('electron');

let config = {};
let mediaRecorder;
let audioChunks = [];
let recordingMonitorInterval = null;

// Load configuration on startup
async function loadSettings() {
    try {
        config = await ipcRenderer.invoke('get-config');
        updateUI();
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Update UI with current configuration
function updateUI() {
    document.getElementById('autoLaunch').checked = config.autoLaunch || false;
    document.getElementById('mode').value = config.mode || 'transcribe';
    document.getElementById('targetLanguage').value = config.targetLanguage || 'zh-cn';
    document.getElementById('hotkey').value = config.hotkey || 'CommandOrControl+Alt+R';
    document.getElementById('modeToggleHotkey').value = config.modeToggleHotkey || 'CommandOrControl+Alt+M';
    document.getElementById('autoUpload').checked = config.autoUpload || false;
    document.getElementById('uploadDelay').value = config.uploadDelay || 1000;
    document.getElementById('webhookEnabled').checked = config.webhookEnabled || false;
    document.getElementById('webhookUrl').value = config.webhookUrl || '';
    document.getElementById('webhookHeaders').value = JSON.stringify(config.webhookHeaders || {});

    // ASR settings
    document.getElementById('asrBackend').value = config.asrBackend || 'paraformer';
    document.getElementById('asrServerUrl').value = config.asrServerUrl || 'http://localhost:8001';
    document.getElementById('qwen3AsrServerUrl').value = config.qwen3Asr?.serverUrl || 'http://127.0.0.1:8002';
    document.getElementById('qwen3AsrModel').value = config.qwen3Asr?.model || 'Qwen/Qwen3-ASR-1.7B';
    document.getElementById('asrFallbackEnabled').checked = config.asrFallback?.enabled !== false;

    // Translation settings
    document.getElementById('translationEnabled').checked = config.translationEnabled !== false;
    document.getElementById('translationServerUrl').value = config.translationServerUrl || 'http://192.168.2.2:1234';
    document.getElementById('translationStyle').value = config.translationStyle || 'professional';
    document.getElementById('translationModel').value = config.translationModel || 'gpt-oss-20b';

    // Text refinement settings
    document.getElementById('textRefinementServerUrl').value = config.textRefinementServerUrl || 'http://192.168.1.41:1234';
    document.getElementById('textRefinementModel').value = config.textRefinementModel || 'Qwen3.5-35B-A3B-Q4_K_M.gguf';
    document.getElementById('textRefinementPrompt').value = config.textRefinementPrompt || '';
    document.getElementById('textRefinementHotkey').value = config.textRefinementHotkey || 'F6';

    // Recording feedback settings
    document.getElementById('soundFeedback').checked = config.soundFeedback !== false;
    document.getElementById('floatingIndicator').checked = config.floatingIndicator !== false;

    // Cancel recording hotkey
    document.getElementById('cancelRecordingHotkey').value = config.cancelRecordingHotkey || 'Escape';

    // 防抖动设置
    document.getElementById('debounceMs').value = config.debounceMs || 300;
    document.getElementById('minRecordDurationMs').value = config.minRecordDurationMs || 600;
    document.getElementById('minIdleDurationMs').value = config.minIdleDurationMs || 500;

    // Quick trigger hotkey
    document.getElementById('quickTriggerHotkey').value = config.quickTriggerHotkey || '';

    // Update mode status display
    updateModeStatus(config.mode);
}

// Save settings
async function saveSettings() {
    try {
        const rawConfig = {
            autoLaunch: document.getElementById('autoLaunch').checked,
            mode: document.getElementById('mode').value,
            targetLanguage: document.getElementById('targetLanguage').value,
            hotkey: document.getElementById('hotkey').value,
            modeToggleHotkey: document.getElementById('modeToggleHotkey').value,
            autoUpload: document.getElementById('autoUpload').checked,
            uploadDelay: parseInt(document.getElementById('uploadDelay').value),
            webhookEnabled: document.getElementById('webhookEnabled').checked,
            webhookUrl: document.getElementById('webhookUrl').value,
            webhookHeaders: JSON.parse(document.getElementById('webhookHeaders').value || '{}'),
            // ASR settings
            asrBackend: document.getElementById('asrBackend').value,
            asrServerUrl: document.getElementById('asrServerUrl').value,
            qwen3Asr: {
                enabled: document.getElementById('asrBackend').value === 'qwen3' || document.getElementById('asrBackend').value === 'auto',
                serverUrl: document.getElementById('qwen3AsrServerUrl').value,
                model: document.getElementById('qwen3AsrModel').value,
                timeout: 60000
            },
            asrFallback: {
                enabled: document.getElementById('asrFallbackEnabled').checked,
                fallbackBackend: 'paraformer'
            },
            // Translation settings
            translationEnabled: document.getElementById('translationEnabled').checked,
            translationServerUrl: document.getElementById('translationServerUrl').value,
            translationStyle: document.getElementById('translationStyle').value,
            translationModel: document.getElementById('translationModel').value,
            // Text refinement settings
            textRefinementServerUrl: document.getElementById('textRefinementServerUrl').value,
            textRefinementModel: document.getElementById('textRefinementModel').value,
            textRefinementPrompt: document.getElementById('textRefinementPrompt').value,
            textRefinementHotkey: document.getElementById('textRefinementHotkey').value.trim(),
            // Recording feedback settings
            soundFeedback: document.getElementById('soundFeedback').checked,
            floatingIndicator: document.getElementById('floatingIndicator').checked,
            // Cancel recording hotkey
            cancelRecordingHotkey: document.getElementById('cancelRecordingHotkey').value.trim(),
            // 防抖动设置
            debounceMs: parseInt(document.getElementById('debounceMs').value) || 300,
            minRecordDurationMs: parseInt(document.getElementById('minRecordDurationMs').value) || 600,
            minIdleDurationMs: parseInt(document.getElementById('minIdleDurationMs').value) || 500,
            // Quick trigger hotkey
            quickTriggerHotkey: document.getElementById('quickTriggerHotkey').value.trim(),
        };

        // 清洗所有字符串字段：移除孤立 surrogate（Windows 输入法/复制粘贴可能产生）
        // 这是 IPC "conversion failure" 的常见根因
        function sanitize(obj) {
            if (typeof obj === 'string') {
                return obj.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
            }
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                const out = {};
                for (const k of Object.keys(obj)) out[k] = sanitize(obj[k]);
                return out;
            }
            return obj;
        }

        // 用 JSON 圆环序列化剥离任何不可结构化克隆的字段（避免 IPC 序列化失败）
        let newConfig;
        try {
            newConfig = sanitize(JSON.parse(JSON.stringify(rawConfig)));
        } catch (jsonErr) {
            console.error('[saveSettings] 配置序列化失败:', jsonErr);
            console.error('rawConfig:', rawConfig);
            alert('配置无法序列化: ' + jsonErr.message);
            return;
        }

        try {
            config = await ipcRenderer.invoke('save-config', newConfig);
        } catch (ipcErr) {
            console.error('[saveSettings] IPC 失败:', ipcErr);
            console.error('newConfig:', newConfig);
            // 找出哪个字段有问题
            for (const k of Object.keys(newConfig)) {
                try {
                    JSON.parse(JSON.stringify(newConfig[k]));
                } catch (e) {
                    console.error(`字段 ${k} 序列化失败:`, e.message, 'value:', newConfig[k]);
                }
            }
            throw ipcErr;
        }

        // Update translator config
        await ipcRenderer.invoke('update-translator-config', {
            serverUrl: newConfig.translationServerUrl,
            model: newConfig.translationModel,
            translationStyle: newConfig.translationStyle
        });

        // Show success feedback
        const btn = document.querySelector('.btn');
        const originalText = btn.textContent;
        btn.textContent = '设置已保存';
        btn.disabled = true;

        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 1500);

    } catch (error) {
        console.error('Failed to save settings:', error);
        alert('保存设置失败: ' + error.message);
    }
}

// Update recording status
function updateRecordingStatus(isRecording) {
    const statusEl = document.getElementById('recordingStatus');
    const hotkey = config.hotkey || 'Ctrl+Shift+R';
    if (isRecording) {
        statusEl.className = 'recording-status recording';
        statusEl.textContent = `正在录音... - 按 ${hotkey} 停止录音`;
    } else {
        statusEl.className = 'recording-status stopped';
        statusEl.textContent = `录音已停止 - 按 ${hotkey} 开始录音`;
    }
}

// Update mode status
function updateModeStatus(mode) {
    const modeEl = document.getElementById('modeStatus');
    const modeNames = {
        'transcribe': '转写模式',
        'translate': '翻译模式',
        'dual': '双语模式'
    };
    const modeHotkey = config.modeToggleHotkey || 'Ctrl+Shift+M';

    if (modeEl) {
        modeEl.textContent = `当前模式：${modeNames[mode] || '转写模式'} - 按 ${modeHotkey} 切换模式`;
    }
}

// Listen for recording state changes
ipcRenderer.on('recording-state-changed', (event, isRecording) => {
    console.log('Recording state changed:', isRecording);

    updateRecordingStatus(isRecording);

    if (isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
});

// Listen for mode changes
ipcRenderer.on('mode-changed', (event, mode) => {
    console.log('Mode changed to:', mode);
    config.mode = mode;
    updateModeStatus(mode);

    // Update select dropdown
    const modeSelect = document.getElementById('mode');
    if (modeSelect) {
        modeSelect.value = mode;
    }
});

// Audio recording functions
async function startRecording() {
    try {
        console.log('Starting recording...');

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
            console.log('Using microphone:', audioTrack.label);
        }

        // Check supported MIME types
        const possibleTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/wav'
        ];

        let selectedMimeType = '';
        for (const type of possibleTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                selectedMimeType = type;
                break;
            }
        }

        if (!selectedMimeType) {
            mediaRecorder = new MediaRecorder(stream);
        } else {
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: selectedMimeType
            });
        }

        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            console.log('Recording stopped, chunks collected:', audioChunks.length);
            processAudio();
        };

        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
        };

        // Start recording with 100ms timeslice
        mediaRecorder.start(100);
        console.log('Recording started');

    } catch (error) {
        console.error('!!! Failed to start recording:', error);
        console.error('!!! Error stack:', error.stack);
        updateRecordingStatus(false);
    }
}

async function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
}

// Convert WebM audio to WAV format
async function convertToWav(webmBlob) {
    return new Promise((resolve, reject) => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const fileReader = new FileReader();

        fileReader.onload = async function(event) {
            try {
                const arrayBuffer = event.target.result;
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                // Convert to WAV
                const wavBuffer = audioBufferToWav(audioBuffer);
                const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

                resolve(wavBlob);
            } catch (error) {
                reject(error);
            }
        };

        fileReader.onerror = reject;
        fileReader.readAsArrayBuffer(webmBlob);
    });
}

// Convert AudioBuffer to WAV format
function audioBufferToWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const data = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        data.push(audioBuffer.getChannelData(i));
    }

    const interleaved = interleave(data);
    const dataLength = interleaved.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // Write WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < interleaved.length; i++) {
        const s = Math.max(-1, Math.min(1, interleaved[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return buffer;
}

function interleave(channelData) {
    const length = channelData[0].length;
    const result = new Float32Array(length * channelData.length);
    let offset = 0;
    for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < channelData.length; channel++) {
            result[offset++] = channelData[channel][i];
        }
    }
    return result;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Process recorded audio
async function processAudio() {
    if (audioChunks.length === 0) {
        console.log('No audio data to process');
        return;
    }

    try {
        console.log('Processing audio...');
        console.log('Audio chunks:', audioChunks.length);
        console.log('Total size:', audioChunks.reduce((sum, chunk) => sum + chunk.size, 0), 'bytes');

        // Create blob from recorded chunks (WebM format)
        const webmBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        console.log('WebM blob size:', webmBlob.size);

        // Convert to WAV format
        console.log('Converting to WAV format...');
        ipcRenderer.send('update-processing-status', { type: 'converting' });
        const wavBlob = await convertToWav(webmBlob);
        console.log('WAV blob size:', wavBlob.size);

        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');

        // Send to ASR server
        console.log('Sending to ASR server...');
        ipcRenderer.send('update-processing-status', { type: 'transcribing' });
        const response = await fetch(`${config.asrServerUrl}/transcribe`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`ASR request failed: ${response.status}`);
        }

        const result = await response.json();
        console.log('ASR result:', result);

        // Handle different response formats
        let transcriptionText = '';

        if (result.text) {
            // Format: { text: "..." }
            transcriptionText = result.text;
        } else if (result.transcription) {
            // Format: { transcription: "..." }
            transcriptionText = result.transcription;
        } else if (result.segments && Array.isArray(result.segments)) {
            // Format: { segments: [{text: "..."}, ...] }
            transcriptionText = result.segments
                .map(seg => seg.text || seg.transcript || '')
                .filter(text => text.trim())
                .join(' ');
            console.log('Extracted from segments:', transcriptionText);
        } else if (typeof result === 'string') {
            // Format: direct string
            transcriptionText = result;
        } else {
            console.error('Unknown ASR response format:', result);
            console.error('Please check the API documentation');
            throw new Error('Invalid ASR response format');
        }

        if (transcriptionText && transcriptionText.trim()) {
            console.log('Transcription text:', transcriptionText);
            await handleTranscriptionResult(transcriptionText);
        } else {
            console.error('No transcription text in response');
            console.error('Result object:', result);
        }

    } catch (error) {
        console.error('Failed to process audio:', error);
    }
}

// Handle transcription result
async function handleTranscriptionResult(text) {
    console.log('Transcription result:', text);
    console.log('Current mode:', config.mode);

    let finalText = text;
    let translationResult = null;

    try {
        // Process based on mode
        switch (config.mode) {
            case 'transcribe':
                // Just use the original text
                finalText = text;
                console.log('[Transcribe Mode] Output:', finalText);
                break;

            case 'translate':
                // Translate to English
                if (config.translationEnabled) {
                    console.log('[Translate Mode] Translating...');
                    ipcRenderer.send('update-processing-status', { type: 'translating' });
                    translationResult = await ipcRenderer.invoke('translate-text', text, config.translationStyle);

                    if (translationResult.success) {
                        finalText = translationResult.translation;
                        console.log('[Translate Mode] Translation:', finalText);
                    } else {
                        console.error('[Translate Mode] Translation failed:', translationResult.error);
                        finalText = text; // Fallback to original text
                    }
                } else {
                    console.warn('[Translate Mode] Translation disabled in config');
                    finalText = text;
                }
                break;

            case 'dual':
                // Show both Chinese and English
                if (config.translationEnabled) {
                    console.log('[Dual Mode] Translating...');
                    ipcRenderer.send('update-processing-status', { type: 'translating' });
                    translationResult = await ipcRenderer.invoke('translate-text', text, config.translationStyle);

                    if (translationResult.success) {
                        finalText = `中文: ${text}\n\nEnglish: ${translationResult.translation}`;
                        console.log('[Dual Mode] Dual output:', finalText);
                    } else {
                        console.error('[Dual Mode] Translation failed:', translationResult.error);
                        finalText = text; // Fallback to original text
                    }
                } else {
                    console.warn('[Dual Mode] Translation disabled in config');
                    finalText = text;
                }
                break;

            default:
                finalText = text;
        }

        // Log the result
        await logResult(text, translationResult);

        // Send webhook if enabled
        if (config.webhookEnabled && config.webhookUrl) {
            await sendWebhook(finalText, text, translationResult);
        }

        // Auto-upload if enabled
        if (config.autoUpload) {
            setTimeout(() => {
                insertText(finalText);
            }, config.uploadDelay);
        }

        // Send completion status and result to main window
        ipcRenderer.send('update-processing-status', { type: 'completed' });
        ipcRenderer.send('send-transcription-result', {
            mode: config.mode,
            text: text,
            translation: translationResult && translationResult.success ? translationResult.translation : null
        });

    } catch (error) {
        console.error('Error handling transcription:', error);
        ipcRenderer.send('update-processing-status', { type: 'error', message: error.message });

        // Fallback to original text
        if (config.autoUpload) {
            setTimeout(() => {
                insertText(text);
            }, config.uploadDelay);
        }
    }
}

// Insert text to active window
async function insertText(text) {
    try {
        // Use auto-paste via main process (PowerShell)
        await ipcRenderer.invoke('auto-paste-text', text);
        console.log('[Auto-Paste] Text pasted at cursor:', text);
    } catch (error) {
        console.error('[Auto-Paste] Failed, falling back to clipboard:', error);
        // Fallback to clipboard if auto-paste fails
        navigator.clipboard.writeText(text).then(() => {
            console.log('Text copied to clipboard:', text);
        }).catch(err => {
            console.error('Failed to copy text:', err);
        });
    }
}

// Log result
async function logResult(text, translationResult = null) {
    try {
        const logEntry = {
            timestamp: new Date().toISOString(),
            text: text,
            mode: config.mode,
            targetLanguage: config.targetLanguage,
            duration: 0,
            confidence: 0,
            processingTime: 0
        };

        // Add translation info if available
        if (translationResult && translationResult.success) {
            logEntry.translation = translationResult.translation;
            logEntry.translationStyle = translationResult.style;
        }

        // Send to main process for logging
        await ipcRenderer.invoke('log-result', logEntry);
        console.log('Log entry recorded:', logEntry);

    } catch (error) {
        console.error('Failed to log result:', error);
    }
}

// Send webhook
async function sendWebhook(finalText, originalText, translationResult = null) {
    try {
        const payload = {
            text: finalText,
            originalText: originalText,
            timestamp: new Date().toISOString(),
            mode: config.mode,
            targetLanguage: config.targetLanguage
        };

        // Add translation info if available
        if (translationResult && translationResult.success) {
            payload.translation = translationResult.translation;
            payload.translationStyle = translationResult.style;
        }

        const response = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...config.webhookHeaders
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Webhook failed: ${response.status}`);
        }

        console.log('Webhook sent successfully');

    } catch (error) {
        console.error('Failed to send webhook:', error);
        // Could queue for retry
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();

    // Check initial recording state
    ipcRenderer.invoke('get-recording-state').then(updateRecordingStatus);
});