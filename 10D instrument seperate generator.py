import os
import threading
import numpy as np
import soundfile as sf
import sounddevice as sd
import tkinter as tk
from tkinter import ttk, messagebox
from spleeter.separator import Separator
from pedalboard import Pedalboard, Reverb, HighpassFilter, LowpassFilter, LowShelfFilter

class StudioGUI:
    def __init__(self, root, vocal_audio, inst_audio, sample_rate, base_name):
        self.root = root
        self.root.title("10D Audio Studio Pro")
        self.root.geometry("420x620")  # Increased height to fit the new slider
        self.root.configure(padx=20, pady=20)

        self.vocal_audio = vocal_audio
        self.inst_audio = inst_audio
        self.sample_rate = sample_rate
        self.base_name = base_name
        
        # Grab a 15-second preview from the middle of the song
        mid_point = len(self.vocal_audio) // 2
        preview_samples = 15 * self.sample_rate
        start = max(0, mid_point - (preview_samples // 2))
        end = min(len(self.vocal_audio), start + preview_samples)
        
        self.vocal_preview = self.vocal_audio[start:end]
        self.inst_preview = self.inst_audio[start:end]
        self.preview_playing = False

        self.build_ui()

    def build_ui(self):
        tk.Label(self.root, text="🎛️ 10D Studio Controls", font=("Helvetica", 16, "bold")).pack(pady=10)

        # --- Distance Control ---
        tk.Label(self.root, text="Distance from Speaker (m)", font=("Helvetica", 10, "bold")).pack(anchor='w', pady=(10, 0))
        tk.Label(self.root, text="Simulates air absorption & volume loss", font=("Helvetica", 8), fg="gray").pack(anchor='w')
        self.dist_slider = ttk.Scale(self.root, from_=1, to=100, orient='horizontal')
        self.dist_slider.set(21)  # Default 21m
        self.dist_slider.pack(fill='x', pady=5)

        # --- Echo Control ---
        tk.Label(self.root, text="Stadium Echo (%)", font=("Helvetica", 10, "bold")).pack(anchor='w', pady=(10, 0))
        self.echo_slider = ttk.Scale(self.root, from_=0, to=100, orient='horizontal')
        self.echo_slider.set(30)  # Default 30%
        self.echo_slider.pack(fill='x', pady=5)

        # --- Pan Depth Control ---
        tk.Label(self.root, text="Ear Pressure (Pan Depth %)", font=("Helvetica", 10, "bold")).pack(anchor='w', pady=(10, 0))
        self.depth_slider = ttk.Scale(self.root, from_=0, to=100, orient='horizontal')
        self.depth_slider.set(75)  # Default 75%
        self.depth_slider.pack(fill='x', pady=5)

        # --- Bass Boost Control ---
        tk.Label(self.root, text="Bass Boost (%)", font=("Helvetica", 10, "bold")).pack(anchor='w', pady=(10, 0))
        tk.Label(self.root, text="Adds deep low-end punch", font=("Helvetica", 8), fg="gray").pack(anchor='w')
        self.bass_slider = ttk.Scale(self.root, from_=0, to=100, orient='horizontal')
        self.bass_slider.set(0)  # Default 0%
        self.bass_slider.pack(fill='x', pady=5)

        # --- Buttons ---
        button_frame = tk.Frame(self.root)
        button_frame.pack(pady=30)

        self.play_btn = tk.Button(button_frame, text="▶ Play Preview", bg="#4CAF50", fg="white", width=15, command=self.toggle_playback)
        self.play_btn.grid(row=0, column=0, padx=10)

        self.export_btn = tk.Button(button_frame, text="💾 Export Full Song", bg="#2196F3", fg="white", width=15, command=self.export_song)
        self.export_btn.grid(row=0, column=1, padx=10)

        # Auto-update audio when sliders are released
        self.dist_slider.bind("<ButtonRelease-1>", lambda e: self.update_live_audio())
        self.echo_slider.bind("<ButtonRelease-1>", lambda e: self.update_live_audio())
        self.depth_slider.bind("<ButtonRelease-1>", lambda e: self.update_live_audio())
        self.bass_slider.bind("<ButtonRelease-1>", lambda e: self.update_live_audio())

    def apply_effects(self, vocals, instruments):
        # 1. Grab values from UI
        dist_m = self.dist_slider.get()
        echo_percent = self.echo_slider.get() / 100.0
        depth_percent = self.depth_slider.get() / 100.0
        bass_percent = self.bass_slider.get()

        # 2. Physics Math
        max_freq = 20000
        min_freq = 1500
        air_absorption_hz = max_freq - ((dist_m / 100) * (max_freq - min_freq))
        dry_volume = max(0.2, 1.0 - (dist_m / 100) * 0.8)
        
        # Convert Bass 0-100% to 0-15 Decibels of gain
        bass_gain_db = (bass_percent / 100.0) * 15.0

        # 3. Build the Pedalboard Effects Chain
        board = Pedalboard([
            # Cut extreme sub-rumble below 50Hz to prevent speaker distortion
            HighpassFilter(cutoff_frequency_hz=50), 
            # Boost the bass frequencies (around 100Hz and below)
            LowShelfFilter(cutoff_frequency_hz=100, gain_db=bass_gain_db),
            # Simulate air absorbing high frequencies over distance
            LowpassFilter(cutoff_frequency_hz=air_absorption_hz),
            # Apply scalable Stadium Echo
            Reverb(
                room_size=max(0.1, echo_percent), 
                damping=0.5, 
                wet_level=echo_percent, 
                dry_level=dry_volume
            ) 
        ])
        
        proc_vocals = board(vocals, self.sample_rate)
        proc_inst = board(instruments, self.sample_rate)
        
        # 4. 10D Panning Math
        duration = len(proc_vocals) / self.sample_rate
        time_array = np.linspace(0, duration, len(proc_vocals), endpoint=False)
        
        lfo_frequency = 0.125 
        base_lfo = np.sin(2 * np.pi * lfo_frequency * time_array) * depth_percent
        
        v_angle = (base_lfo + 1) * (np.pi / 4)
        i_angle = (-base_lfo + 1) * (np.pi / 4)
        
        final_audio = np.zeros_like(proc_vocals)
        
        # Mix Vocals (Left/Right)
        final_audio[:, 0] += proc_vocals[:, 0] * np.cos(v_angle)
        final_audio[:, 1] += proc_vocals[:, 1] * np.sin(v_angle)
        
        # Mix Instruments (Opposite direction, 70% volume so they don't overpower vocals)
        final_audio[:, 0] += (proc_inst[:, 0] * np.cos(i_angle)) * 0.70
        final_audio[:, 1] += (proc_inst[:, 1] * np.sin(i_angle)) * 0.70

        # Anti-clipping protection
        max_amp = np.max(np.abs(final_audio))
        if max_amp > 1.0:
            final_audio = final_audio / max_amp
            
        return final_audio

    def update_live_audio(self):
        if self.preview_playing:
            sd.stop()
            processed_preview = self.apply_effects(self.vocal_preview, self.inst_preview)
            sd.play(processed_preview, self.sample_rate, loop=True)

    def toggle_playback(self):
        if self.preview_playing:
            sd.stop()
            self.play_btn.config(text="▶ Play Preview", bg="#4CAF50")
            self.preview_playing = False
        else:
            processed_preview = self.apply_effects(self.vocal_preview, self.inst_preview)
            sd.play(processed_preview, self.sample_rate, loop=True)
            self.play_btn.config(text="⏸ Stop Preview", bg="#f44336")
            self.preview_playing = True

    def export_song(self):
        sd.stop()
        self.play_btn.config(text="▶ Play Preview", bg="#4CAF50")
        self.preview_playing = False
        self.export_btn.config(text="⏳ Processing...", state=tk.DISABLED)
        self.root.update()

        def process_and_save():
            try:
                final_audio = self.apply_effects(self.vocal_audio, self.inst_audio)
                out_name = f"10D_Custom_{self.base_name}.wav"
                sf.write(out_name, final_audio, self.sample_rate)
                messagebox.showinfo("Success!", f"Saved successfully as:\n{out_name}")
            except Exception as e:
                messagebox.showerror("Error", str(e))
            finally:
                self.export_btn.config(text="💾 Export Full Song", state=tk.NORMAL)

        threading.Thread(target=process_and_save).start()

def main():
    input_file = "ek_jibone.mp3" 
    output_dir = "separated_stems"
    
    if not os.path.exists(input_file):
        print(f"❌ Error: Please place an audio file named '{input_file}' in this folder.")
        return

    print("🎵 Step 1: Isolating tracks. This may take a moment...")
    separator = Separator('spleeter:2stems')
    separator.separate_to_file(input_file, output_dir)
    
    base_name = os.path.splitext(os.path.basename(input_file))[0]
    vocals_path = os.path.join(output_dir, base_name, 'vocals.wav')
    inst_path = os.path.join(output_dir, base_name, 'accompaniment.wav')
    
    print("🎛️ Step 2: Loading tracks into memory...")
    vocal_audio, sample_rate = sf.read(vocals_path)
    inst_audio, _ = sf.read(inst_path)
    
    if vocal_audio.ndim == 1: vocal_audio = np.column_stack((vocal_audio, vocal_audio))
    if inst_audio.ndim == 1: inst_audio = np.column_stack((inst_audio, inst_audio))
        
    min_length = min(len(vocal_audio), len(inst_audio))
    vocal_audio = vocal_audio[:min_length]
    inst_audio = inst_audio[:min_length]

    print("🖥️ Launching GUI...")
    root = tk.Tk()
    app = StudioGUI(root, vocal_audio, inst_audio, sample_rate, base_name)
    
    def on_closing():
        sd.stop()
        root.destroy()
    root.protocol("WM_DELETE_WINDOW", on_closing)
    
    root.mainloop()

if __name__ == "__main__":
    main()
