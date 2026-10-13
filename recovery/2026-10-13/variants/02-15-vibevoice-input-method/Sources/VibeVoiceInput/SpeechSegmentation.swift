import Foundation

struct SpeechSegmentationConfig: Equatable {
    var analysisWindowSeconds = 0.03
    var analysisHopSeconds = 0.01
    var minimumSilenceSeconds = 0.30
    var minimumSegmentSeconds = 6.0
    var targetSegmentSeconds = 10.0
    var searchRadiusSeconds = 5.0
    var liveMarginSeconds = 1.5
    var pausePercentile = 30.0
    var pauseThresholdCap: Float = 0.55
}

struct SpeechSegmenter {
    let config: SpeechSegmentationConfig

    init(config: SpeechSegmentationConfig = SpeechSegmentationConfig()) {
        self.config = config
    }

    /// Plans complete, non-overlapping ranges. Overlap for ASR context is added by the session,
    /// not here, so the canonical ownership of every sample remains unambiguous.
    func plan(samples: [Float], sampleRate: Int) -> [Range<Int>] {
        guard !samples.isEmpty, sampleRate > 0 else { return [] }
        let minimum = sampleCount(config.minimumSegmentSeconds, sampleRate: sampleRate)
        let target = sampleCount(config.targetSegmentSeconds, sampleRate: sampleRate)
        let radius = sampleCount(config.searchRadiusSeconds, sampleRate: sampleRate)
        let pauses = pauseCandidates(in: samples, sampleRate: sampleRate)
        guard !pauses.isEmpty else { return [0..<samples.count] }

        var ranges: [Range<Int>] = []
        var start = 0
        while samples.count - start >= minimum * 2 {
            let desired = start + target
            let candidates = pauses.filter {
                $0 > start + minimum &&
                samples.count - $0 >= minimum &&
                abs($0 - desired) <= radius
            }
            guard let cut = candidates.min(by: { abs($0 - desired) < abs($1 - desired) }) else { break }
            ranges.append(start..<cut)
            start = cut
        }
        ranges.append(start..<samples.count)
        return ranges
    }

    /// Returns a cut that is old enough to be stable while recording continues.
    func stableCut(in samples: [Float], sampleRate: Int, after committedIndex: Int) -> Int? {
        guard sampleRate > 0, committedIndex >= 0, committedIndex < samples.count else { return nil }
        let minimum = sampleCount(config.minimumSegmentSeconds, sampleRate: sampleRate)
        let target = committedIndex + sampleCount(config.targetSegmentSeconds, sampleRate: sampleRate)
        let radius = sampleCount(config.searchRadiusSeconds, sampleRate: sampleRate)
        let liveEnd = samples.count - sampleCount(config.liveMarginSeconds, sampleRate: sampleRate)
        guard liveEnd - committedIndex >= minimum else { return nil }

        return pauseCandidates(in: samples, sampleRate: sampleRate)
            .filter {
                $0 > committedIndex + minimum &&
                $0 <= liveEnd &&
                abs($0 - target) <= radius
            }
            .min(by: { abs($0 - target) < abs($1 - target) })
    }

    private func pauseCandidates(in samples: [Float], sampleRate: Int) -> [Int] {
        let window = max(1, sampleCount(config.analysisWindowSeconds, sampleRate: sampleRate))
        let hop = max(1, sampleCount(config.analysisHopSeconds, sampleRate: sampleRate))
        guard samples.count >= window else { return [] }

        var energies: [Float] = []
        var starts: [Int] = []
        var start = 0
        while start + window <= samples.count {
            var sum: Float = 0
            for index in start..<(start + window) {
                sum += samples[index] * samples[index]
            }
            energies.append((sum / Float(window)).squareRoot())
            starts.append(start)
            start += hop
        }
        guard energies.count >= 10 else { return [] }

        let sorted = energies.sorted()
        let floor = percentile(sorted, config.pausePercentile / 3)
        let speech = percentile(sorted, 90)
        guard speech > 0.001, speech - floor > 0.0001 else { return [] }
        let span = speech - floor
        let activity = energies.map { min(max(($0 - floor) / span, 0), 1) }
        let threshold = min(percentile(activity.sorted(), config.pausePercentile), config.pauseThresholdCap)
        let minimumFrames = max(1, Int((config.minimumSilenceSeconds / config.analysisHopSeconds).rounded(.up)))

        var pauses: [Int] = []
        var index = 0
        while index < activity.count {
            guard activity[index] < threshold else {
                index += 1
                continue
            }
            var end = index
            while end < activity.count, activity[end] < threshold { end += 1 }
            if end - index >= minimumFrames {
                var quietest = index
                for candidate in index..<end where energies[candidate] < energies[quietest] {
                    quietest = candidate
                }
                pauses.append(min(starts[quietest] + window / 2, samples.count))
            }
            index = end
        }
        return pauses
    }

    private func sampleCount(_ seconds: Double, sampleRate: Int) -> Int {
        Int((seconds * Double(sampleRate)).rounded())
    }

    private func percentile(_ sorted: [Float], _ percentile: Double) -> Float {
        guard let first = sorted.first else { return 0 }
        guard sorted.count > 1 else { return first }
        let rank = max(0, min(100, percentile)) / 100 * Double(sorted.count - 1)
        let lower = Int(rank.rounded(.down))
        let fraction = Float(rank - Double(lower))
        guard lower + 1 < sorted.count else { return sorted[lower] }
        return sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower])
    }
}

enum TranscriptSegmentState: Equatable {
    case success(String)
    case failed(String)
}

struct RecognizedSegment: Equatable {
    let index: Int
    let sampleRange: Range<Int>
    let state: TranscriptSegmentState
}

struct TranscriptAssemblyResult: Equatable {
    let text: String
    let failedSegmentIndexes: [Int]

    var isComplete: Bool { failedSegmentIndexes.isEmpty }
}

enum TranscriptAssembler {
    static func assemble(_ segments: [RecognizedSegment]) -> TranscriptAssemblyResult {
        let ordered = segments.sorted { $0.index < $1.index }
        var text = ""
        var failed: [Int] = []

        for segment in ordered {
            switch segment.state {
            case .success(let value):
                text = append(value.trimmingCharacters(in: .whitespacesAndNewlines), to: text)
            case .failed:
                failed.append(segment.index)
            }
        }
        return TranscriptAssemblyResult(text: text, failedSegmentIndexes: failed)
    }

    private static func append(_ next: String, to current: String) -> String {
        guard !next.isEmpty else { return current }
        guard !current.isEmpty else { return next }
        let left = Array(current)
        let right = Array(next)
        let maximum = min(32, left.count, right.count)
        if maximum >= 2 {
            for count in stride(from: maximum, through: 2, by: -1) {
                if Array(left.suffix(count)) == Array(right.prefix(count)) {
                    return current + String(right.dropFirst(count))
                }
            }
        }
        return current + next
    }
}
