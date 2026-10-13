import AVFoundation
import AppKit

final class AudioRecorder {
    private var recorder: AVAudioRecorder?

    func start(at url: URL) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 24_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        guard recorder.prepareToRecord(), recorder.record() else {
            throw NSError(domain: "VibeVoiceInput", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "无法启动麦克风录音"])
        }
        self.recorder = recorder
    }

    func stop() {
        recorder?.stop()
        recorder = nil
    }

    func samples(at url: URL) throws -> [Float] {
        try PCM16WAV.readSamples(from: url)
    }

    func normalizedLevel() -> CGFloat {
        guard let recorder, recorder.isRecording else { return 0 }
        recorder.updateMeters()
        let decibels = max(-55, min(0, recorder.averagePower(forChannel: 0)))
        let normalized = CGFloat((decibels + 55) / 55)
        return pow(normalized, 1.55)
    }
}
