// ==UserScript==
// @name         10D Stadium Pro For Quran Recitation
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Simulates massive stadium speakers. Defaults to ON and remembers your slider settings across reloads.
// @author       Guess The Case
// @match        *://*.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    let audioCtx = null;
    let sourceNode = null;
    let nodes = {};
    let isAudioInitialized = false;

    // --- 1. LOAD SAVED SETTINGS OR USE DEFAULTS ---
    let settings = {
        active: localStorage.getItem('gtc_active') !== 'false', // Defaults to true
        dist: localStorage.getItem('gtc_dist') || 47,
        echo: localStorage.getItem('gtc_echo') || 130,
        rotate: localStorage.getItem('gtc_rotate') === 'true',  // Defaults to false
        depth: localStorage.getItem('gtc_depth') || 70
    };

    // --- 2. YOUTUBE SECURITY BYPASS ---
    let trustedPolicy;
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
            trustedPolicy = window.trustedTypes.createPolicy('stadium-ui-policy', { createHTML: (s) => s });
        } catch (e) {
            trustedPolicy = window.trustedTypes.createPolicy('default', { createHTML: (s) => s });
        }
    }
    function safeHTML(htmlString) {
        return trustedPolicy ? trustedPolicy.createHTML(htmlString) : htmlString;
    }

    // --- 3. BUILD AND INJECT THE UI PANEL ---
    function injectUI() {
        if (document.getElementById('stadium-control-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'stadium-control-panel';

        // Determine initial button state visually
        const btnColor = settings.active ? '#00cc00' : '#ff4444';
        const btnText = settings.active ? 'ON' : 'OFF';
        const depthOpacity = settings.rotate ? '1' : '0.4';
        const depthText = settings.rotate ? settings.depth + '%' : 'Disabled';
        const rotateChecked = settings.rotate ? 'checked' : '';

        const uiString = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px;">
                <h3 style="margin: 0; font-size: 16px; color: #fff;">🏟️ Stadium Audio for Quran Recitation by GTC</h3>
                <button id="master-toggle" style="background: ${btnColor}; border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">${btnText}</button>
            </div>

            <div class="control-group" style="margin-top: 15px;">
                <label style="display: flex; justify-content: space-between; font-size: 12px; color: #ccc; font-weight: bold;">
                    <span style="color: #00ffcc;">Distance from Speaker</span> <span id="dist-val" style="color: #00ffcc;">${settings.dist}m</span>
                </label>
                <input type="range" id="dist-slider" min="1" max="100" value="${settings.dist}" style="width: 100%; margin-top: 5px;">
                <div style="font-size: 10px; color: #888; margin-top: 2px;">Simulates air absorption & volume loss</div>
            </div>

            <div class="control-group" style="margin-top: 15px;">
                <label style="display: flex; justify-content: space-between; font-size: 12px; color: #ccc;">
                    <span>Stadium Echo Limit</span> <span id="echo-val">${settings.echo}%</span>
                </label>
                <input type="range" id="echo-slider" min="0" max="150" value="${settings.echo}" style="width: 100%; margin-top: 5px;">
            </div>

            <div class="control-group" style="margin-top: 15px;">
                <label style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #ccc;">
                    <span>Auto-Rotate (10D)</span>
                    <input type="checkbox" id="rotate-toggle" ${rotateChecked} style="width: 16px; height: 16px;">
                </label>
            </div>

            <div class="control-group" id="depth-container" style="margin-top: 15px; opacity: ${depthOpacity};">
                <label style="display: flex; justify-content: space-between; font-size: 12px; color: #ccc;">
                    <span>Ear Pressure (Pan Depth)</span> <span id="depth-val">${depthText}</span>
                </label>
                <input type="range" id="depth-slider" min="0" max="100" value="${settings.depth}" style="width: 100%; margin-top: 5px;">
                <div style="font-size: 10px; color: #888; margin-top: 2px;">Lower % = Less blank ear feeling</div>
            </div>
        `;

        panel.innerHTML = safeHTML(uiString);

        Object.assign(panel.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '280px',
            background: 'rgba(20, 20, 20, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid #333',
            borderRadius: '12px',
            padding: '15px',
            zIndex: '2147483647',
            fontFamily: 'sans-serif',
            boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
            color: 'white'
        });

        document.body.appendChild(panel);

        document.getElementById('master-toggle').addEventListener('click', () => {
            settings.active = !settings.active;
            localStorage.setItem('gtc_active', settings.active);
            applyAudioRouting();
        });

        document.getElementById('dist-slider').addEventListener('input', syncAudioWithUI);
        document.getElementById('echo-slider').addEventListener('input', syncAudioWithUI);
        document.getElementById('rotate-toggle').addEventListener('change', syncAudioWithUI);
        document.getElementById('depth-slider').addEventListener('input', syncAudioWithUI);
    }

    // --- 4. AUDIO PROCESSING SETUP ---
    function setupAudioNodes(mediaElement) {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        try {
            if (!sourceNode) sourceNode = audioCtx.createMediaElementSource(mediaElement);
        } catch (e) {
            console.log("Audio source already connected, reusing.");
        }

        nodes.eq = audioCtx.createBiquadFilter();
        nodes.eq.type = 'lowshelf';
        nodes.eq.frequency.value = 250;
        nodes.eq.gain.value = 4;

        nodes.airAbsorption = audioCtx.createBiquadFilter();
        nodes.airAbsorption.type = 'lowpass';
        nodes.airAbsorption.frequency.value = 20000;

        nodes.preDelay = audioCtx.createDelay(1.0);
        nodes.preDelay.delayTime.value = 0.12;

        nodes.convolver = audioCtx.createConvolver();
        nodes.convolver.buffer = generateStadiumImpulseResponse(audioCtx, 5.0, 3.5);

        nodes.reverbFilter = audioCtx.createBiquadFilter();
        nodes.reverbFilter.type = 'lowpass';
        nodes.reverbFilter.frequency.value = 2000;

        nodes.dryNode = audioCtx.createGain();
        nodes.wetNode = audioCtx.createGain();

        nodes.panner = audioCtx.createStereoPanner();
        nodes.lfo = audioCtx.createOscillator();
        nodes.lfo.type = 'sine';
        nodes.lfo.frequency.value = 0.08;

        nodes.panDepth = audioCtx.createGain();
        nodes.lfo.connect(nodes.panDepth);
        nodes.panDepth.connect(nodes.panner.pan);
        nodes.lfo.start();

        isAudioInitialized = true;
        syncAudioWithUI();
    }

    function applyAudioRouting() {
        const mediaElement = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (!mediaElement) return;

        if (!isAudioInitialized) setupAudioNodes(mediaElement);
        if (audioCtx.state === 'suspended') audioCtx.resume();

        try { sourceNode.disconnect(); } catch (e) {}

        const btn = document.getElementById('master-toggle');

        if (settings.active) {
            sourceNode.connect(nodes.eq);
            nodes.eq.connect(nodes.airAbsorption);

            nodes.airAbsorption.connect(nodes.dryNode);
            nodes.dryNode.connect(nodes.panner);

            nodes.airAbsorption.connect(nodes.preDelay);
            nodes.preDelay.connect(nodes.convolver);
            nodes.convolver.connect(nodes.reverbFilter);
            nodes.reverbFilter.connect(nodes.wetNode);
            nodes.wetNode.connect(nodes.panner);

            nodes.panner.connect(audioCtx.destination);

            btn.innerText = 'ON';
            btn.style.background = '#00cc00';
        } else {
            sourceNode.connect(audioCtx.destination);
            btn.innerText = 'OFF';
            btn.style.background = '#ff4444';
        }
    }

    function generateStadiumImpulseResponse(ctx, duration, decay) {
        const sampleRate = ctx.sampleRate;
        const length = sampleRate * duration;
        const impulse = ctx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        for (let i = 0; i < length; i++) {
            const n = duration - i / sampleRate;
            left[i] = (Math.random() * 2 - 1) * Math.pow(n / duration, decay) * 0.5;
            right[i] = (Math.random() * 2 - 1) * Math.pow(n / duration, decay) * 0.5;
        }
        return impulse;
    }

    // --- 5. THE PHYSICS ENGINE & MEMORY SAVER ---
    function syncAudioWithUI() {
        // Save state to local memory
        const distMeters = document.getElementById('dist-slider').value;
        const baseEcho = document.getElementById('echo-slider').value;
        const isRotating = document.getElementById('rotate-toggle').checked;
        const depthVal = document.getElementById('depth-slider').value;

        localStorage.setItem('gtc_dist', distMeters);
        localStorage.setItem('gtc_echo', baseEcho);
        localStorage.setItem('gtc_rotate', isRotating);
        localStorage.setItem('gtc_depth', depthVal);

        if (!nodes.wetNode) return; // Skip if audio isn't hooked up yet

        // Update UI Text
        document.getElementById('dist-val').innerText = distMeters + 'm';
        document.getElementById('echo-val').innerText = baseEcho + '%';

        // Math
        const maxFreq = 20000;
        const minFreq = 1500;
        const frequencyDrop = maxFreq - ((distMeters / 100) * (maxFreq - minFreq));
        nodes.airAbsorption.frequency.value = frequencyDrop;

        const dryVolume = Math.max(0.2, 1.0 - (distMeters / 100) * 0.8);
        nodes.dryNode.gain.value = dryVolume;
        nodes.wetNode.gain.value = baseEcho / 100;

        document.getElementById('depth-container').style.opacity = isRotating ? '1' : '0.4';

        if (isRotating) {
            nodes.panDepth.gain.value = depthVal / 100;
            document.getElementById('depth-val').innerText = depthVal + '%';
        } else {
            nodes.panDepth.gain.value = 0;
            document.getElementById('depth-val').innerText = 'Disabled';
        }
    }

    // --- 6. RELIABLE INJECTION & AUTO-HOOK ON PLAY ---
    const initInterval = setInterval(() => {
        if (document.body) {
            clearInterval(initInterval);
            injectUI();

            // Periodically check for the video element to hook the auto-start
            const videoCheckInterval = setInterval(() => {
                const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
                if (video) {
                    clearInterval(videoCheckInterval);

                    // As soon as the video plays, engage the effect if it's set to ON
                    video.addEventListener('play', () => {
                        if (settings.active && !isAudioInitialized) {
                            applyAudioRouting();
                        }
                    });

                    // Fallback: Apply immediately if video is already playing upon script load
                    if (!video.paused && settings.active) {
                        applyAudioRouting();
                    }
                }
            }, 500);
        }
    }, 500);

})();
