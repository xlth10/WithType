import AppKit
import QuartzCore

/// A minimal, non-activating Liquid Glass surface driven by real microphone energy.
/// Visual detail stays in the menu bar; the HUD communicates state through motion.
final class VoiceHUDController {
    var onCancel: (() -> Void)?
    var onStop: (() -> Void)?
    var onCopy: (() -> Void)?
    private final class HoverSurface: NSView {
        var hoverChanged: ((Bool) -> Void)?
        override func updateTrackingAreas() {
            super.updateTrackingAreas()
            trackingAreas.forEach(removeTrackingArea)
            addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
        }
        override func mouseEntered(with event: NSEvent) { hoverChanged?(true) }
        override func mouseExited(with event: NSEvent) { hoverChanged?(false) }
    }
    private struct Presentation {
        let mode: FluidWaveView.Mode
        let symbolName: String?
        let accessibilityLabel: String
    }

    private final class PassivePanel: NSPanel {
        override var canBecomeKey: Bool { false }
        override var canBecomeMain: Bool { false }
    }

    private final class FluidWaveView: NSView {
        enum Mode: Equatable {
            case hidden
            case permission
            case recording
            case processing
            case success
            case error
        }

        private struct ProfilePoint {
            var centerOffset: CGFloat
            var halfHeight: CGFloat
        }

        var reduceMotion = false {
            didSet {
                if reduceMotion {
                    transitionBlend = 1
                    transitionVelocity = 0
                    sourceProfile = nil
                }
                needsDisplay = true
            }
        }

        private(set) var mode: Mode = .hidden
        private let sampleCount = 38
        private var smoothedLevel = CGFloat.zero
        private var phase = CGFloat.zero
        private var lastTick = CACurrentMediaTime()
        private var sourceProfile: [ProfilePoint]?
        private var transitionBlend = CGFloat(1)
        private var transitionVelocity = CGFloat.zero

        override var isOpaque: Bool { false }

        var glassTintColor: NSColor {
            switch mode {
            case .recording: return .systemRed
            case .processing: return .systemBlue
            case .permission: return .controlAccentColor
            case .success: return .systemGreen
            case .error: return .systemOrange
            case .hidden: return .clear
            }
        }

        func setMode(_ newMode: Mode, morphing: Bool) {
            guard newMode != mode else { return }
            let current = currentProfile()
            mode = newMode
            lastTick = CACurrentMediaTime()

            if morphing, !reduceMotion, newMode != .hidden {
                sourceProfile = current
                transitionBlend = 0
                transitionVelocity = 0
            } else {
                sourceProfile = nil
                transitionBlend = 1
                transitionVelocity = 0
            }

            if newMode == .recording {
                smoothedLevel = 0
            }
            needsDisplay = true
        }

        func tick(audioLevel: CGFloat?, at timestamp: CFTimeInterval = CACurrentMediaTime()) {
            let delta = min(max(CGFloat(timestamp - lastTick), 1.0 / 240.0), 1.0 / 20.0)
            lastTick = timestamp

            if let audioLevel, mode == .recording {
                let target = min(max(audioLevel, 0), 1)
                let response = target > smoothedLevel ? CGFloat(22) : CGFloat(7.5)
                let blend = 1 - exp(-response * delta)
                smoothedLevel += (target - smoothedLevel) * blend
            }

            if !reduceMotion {
                switch mode {
                case .recording:
                    phase += delta * (2.3 + smoothedLevel * 1.7)
                case .processing:
                    phase += delta * 3.6
                case .permission:
                    phase += delta * 1.7
                case .success, .error:
                    phase += delta * 1.2
                case .hidden:
                    break
                }
            }

            advanceMorph(by: delta)
            needsDisplay = true
        }

        override func draw(_ dirtyRect: NSRect) {
            super.draw(dirtyRect)
            guard mode != .hidden, bounds.width > 1, bounds.height > 1 else { return }

            NSGraphicsContext.current?.cgContext.setShouldAntialias(true)
            if mode == .processing || mode == .permission {
                drawQuietTrack()
            }

            let path = makePath(from: currentProfile())
            drawGlow(for: path)

            NSGraphicsContext.saveGraphicsState()
            path.addClip()
            gradientForCurrentMode()?.draw(in: bounds.insetBy(dx: 2, dy: 0), angle: 0)
            NSGraphicsContext.restoreGraphicsState()

            NSColor.white.withAlphaComponent(0.24).setStroke()
            path.lineWidth = 0.55
            path.stroke()
        }

        private func advanceMorph(by delta: CGFloat) {
            guard sourceProfile != nil, transitionBlend < 1, !reduceMotion else { return }

            // Critically damped spring. A new state can retarget from the current profile.
            let response = CGFloat(0.32)
            let omega = (2 * .pi) / response
            let acceleration = omega * omega * (1 - transitionBlend)
                - 2 * omega * transitionVelocity
            transitionVelocity += acceleration * delta
            transitionBlend += transitionVelocity * delta

            if transitionBlend >= 0.999 && abs(transitionVelocity) < 0.02 {
                transitionBlend = 1
                transitionVelocity = 0
                sourceProfile = nil
            } else {
                transitionBlend = min(max(transitionBlend, 0), 1)
            }
        }

        private func currentProfile() -> [ProfilePoint] {
            let target = profile(for: mode)
            guard let sourceProfile, transitionBlend < 1, sourceProfile.count == target.count else {
                return target
            }

            return zip(sourceProfile, target).map { source, destination in
                ProfilePoint(
                    centerOffset: source.centerOffset
                        + (destination.centerOffset - source.centerOffset) * transitionBlend,
                    halfHeight: source.halfHeight
                        + (destination.halfHeight - source.halfHeight) * transitionBlend
                )
            }
        }

        private func profile(for mode: Mode) -> [ProfilePoint] {
            (0..<sampleCount).map { index in
                let t = CGFloat(index) / CGFloat(sampleCount - 1)
                let envelope = pow(max(sin(.pi * t), 0), 0.58)

                switch mode {
                case .recording:
                    let voice = pow(max(smoothedLevel, 0.025), 0.68)
                    let primaryWave = sin(t * .pi * 3.1 + phase) * 1.35
                    let detailWave = sin(t * .pi * 5.4 - phase * 0.72) * 0.62
                    let surfaceFlow = 0.78 + 0.22 * sin(t * .pi * 4.2 - phase * 1.25)
                    return ProfilePoint(
                        centerOffset: (primaryWave + detailWave) * envelope * (0.24 + voice * 1.7),
                        halfHeight: 1.35 + envelope * (1.15 + voice * 8.3 * surfaceFlow)
                    )

                case .processing:
                    let travel = (1 - cos(phase)) / 2
                    let leadingDistance = (t - travel) / 0.145
                    let trailingCenter = max(min(travel - 0.18 * sin(phase), 1), 0)
                    let trailingDistance = (t - trailingCenter) / 0.24
                    let leadingBlob = exp(-(leadingDistance * leadingDistance))
                    let trailingFilm = exp(-(trailingDistance * trailingDistance))
                    return ProfilePoint(
                        centerOffset: sin(t * .pi * 3.2 + phase * 0.65)
                            * (0.4 + leadingBlob * 1.25),
                        halfHeight: 0.7 + leadingBlob * 7.8 + trailingFilm * 1.9
                    )

                case .permission:
                    let distance = (t - 0.5) / 0.17
                    let blob = exp(-(distance * distance))
                    return ProfilePoint(
                        centerOffset: sin(phase) * blob * 0.8,
                        halfHeight: 0.65 + blob * (7.3 + sin(phase * 1.4) * 0.8)
                    )

                case .success, .error:
                    let distance = (t - 0.5) / 0.105
                    let blob = exp(-(distance * distance))
                    return ProfilePoint(
                        centerOffset: 0,
                        halfHeight: 0.45 + blob * 10.2
                    )

                case .hidden:
                    return ProfilePoint(centerOffset: 0, halfHeight: 0)
                }
            }
        }

        private func makePath(from profile: [ProfilePoint]) -> NSBezierPath {
            let horizontalInset = CGFloat(3)
            let usableWidth = max(bounds.width - horizontalInset * 2, 1)
            var topPoints = [NSPoint]()
            var bottomPoints = [NSPoint]()
            topPoints.reserveCapacity(profile.count)
            bottomPoints.reserveCapacity(profile.count)

            for (index, point) in profile.enumerated() {
                let t = CGFloat(index) / CGFloat(max(profile.count - 1, 1))
                let x = horizontalInset + usableWidth * t
                let centerY = bounds.midY + point.centerOffset
                topPoints.append(NSPoint(x: x, y: centerY + point.halfHeight))
                bottomPoints.append(NSPoint(x: x, y: centerY - point.halfHeight))
            }

            return smoothClosedPath(points: topPoints + bottomPoints.reversed())
        }

        private func smoothClosedPath(points: [NSPoint]) -> NSBezierPath {
            let path = NSBezierPath()
            guard points.count > 3 else { return path }
            path.move(to: points[0])

            for index in 0..<points.count {
                let previous = points[(index - 1 + points.count) % points.count]
                let current = points[index]
                let next = points[(index + 1) % points.count]
                let following = points[(index + 2) % points.count]
                let control1 = NSPoint(
                    x: current.x + (next.x - previous.x) / 6,
                    y: current.y + (next.y - previous.y) / 6
                )
                let control2 = NSPoint(
                    x: next.x - (following.x - current.x) / 6,
                    y: next.y - (following.y - current.y) / 6
                )
                path.curve(to: next, controlPoint1: control1, controlPoint2: control2)
            }
            path.close()
            return path
        }

        private func drawQuietTrack() {
            let rect = NSRect(x: 4, y: bounds.midY - 0.6, width: bounds.width - 8, height: 1.2)
            NSColor.secondaryLabelColor.withAlphaComponent(0.1).setFill()
            NSBezierPath(roundedRect: rect, xRadius: 0.6, yRadius: 0.6).fill()
        }

        private func drawGlow(for path: NSBezierPath) {
            NSGraphicsContext.saveGraphicsState()
            let shadow = NSShadow()
            shadow.shadowColor = glassTintColor.withAlphaComponent(0.42)
            shadow.shadowBlurRadius = mode == .recording ? 7 : 9
            shadow.shadowOffset = .zero
            shadow.set()
            glassTintColor.withAlphaComponent(0.52).setFill()
            path.fill()
            NSGraphicsContext.restoreGraphicsState()
        }

        private func gradientForCurrentMode() -> NSGradient? {
            switch mode {
            case .recording:
                return NSGradient(colors: [.systemPink, .systemRed, .systemOrange])
            case .processing:
                return NSGradient(colors: [.systemIndigo, .systemBlue, .systemTeal])
            case .permission:
                return NSGradient(colors: [.systemBlue, .controlAccentColor, .systemTeal])
            case .success:
                return NSGradient(colors: [.systemMint, .systemGreen, .systemTeal])
            case .error:
                return NSGradient(colors: [.systemYellow, .systemOrange, .systemRed])
            case .hidden:
                return nil
            }
        }
    }

    private let panel: PassivePanel
    private let rootView = HoverSurface()
    private let controls = NSStackView()
    private var stopButton: NSButton!
    private var cancelButton: NSButton!
    private var copyButton: NSButton!
    private let materialView = NSVisualEffectView()
    private var nativeGlassView: NSView?
    private var usesNativeGlass = false
    private let fluidView = FluidWaveView()
    private let symbolView = NSImageView()

    private var updateTimer: Timer?
    private var audioLevelProvider: (() -> CGFloat)?
    private var scheduledDismiss: DispatchWorkItem?
    private var displayOptionsObserver: NSObjectProtocol?
    private var presentationGeneration = 0

    private var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    init() {
        panel = PassivePanel(
            contentRect: NSRect(x: 0, y: 0, width: 176, height: 54),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )

        configurePanel()
        configureViews()
        displayOptionsObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            let levelProvider = self.audioLevelProvider
            self.applyDisplayPreferences()
            self.startUpdates(for: self.fluidView.mode, audioLevelProvider: levelProvider)
        }
    }

    deinit {
        updateTimer?.invalidate()
        scheduledDismiss?.cancel()
        if let displayOptionsObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(displayOptionsObserver)
        }
    }

    func showRequestingPermission() {
        present(Presentation(
            mode: .permission,
            symbolName: "mic.fill",
            accessibilityLabel: "等待麦克风权限"
        ))
    }

    func showRecording(levelProvider: @escaping () -> CGFloat) {
        present(Presentation(
            mode: .recording,
            symbolName: nil,
            accessibilityLabel: "正在录音，再按 Option 空格结束"
        ), audioLevelProvider: levelProvider)
    }

    func showTranscribing() {
        present(Presentation(
            mode: .processing,
            symbolName: nil,
            accessibilityLabel: "正在本地转写"
        ))
    }

    func updatePartialTranscript(_ text: String) {
        guard fluidView.mode == .processing else { return }
        let oneLine = text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !oneLine.isEmpty else { return }
        panel.setAccessibilityValue("正在本地转写，\(oneLine)")
    }

    func showSuccess() {
        present(Presentation(
            mode: .success,
            symbolName: "checkmark",
            accessibilityLabel: "已发送粘贴，结果已保留"
        ))
        dismiss(after: 0.68)
    }

    func showError(_ message: String) {
        present(Presentation(
            mode: .error,
            symbolName: "exclamationmark",
            accessibilityLabel: "没有完成，\(message.replacingOccurrences(of: "\n", with: " "))"
        ))
        // Errors remain recoverable until copied, dismissed, or a new session begins.
    }

    func hide(animated: Bool = true) {
        presentationGeneration += 1
        scheduledDismiss?.cancel()
        scheduledDismiss = nil
        stopUpdates()

        guard panel.isVisible else { return }
        let generation = presentationGeneration

        if !animated {
            panel.orderOut(nil)
            panel.alphaValue = 1
            fluidView.setMode(.hidden, morphing: false)
            return
        }

        if !reduceMotion {
            let collapse = CABasicAnimation(keyPath: "transform")
            collapse.fromValue = NSValue(caTransform3D: CATransform3DIdentity)
            collapse.toValue = NSValue(caTransform3D: CATransform3DMakeScale(0.62, 0.82, 1))
            collapse.duration = 0.17
            collapse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            let surfaceView = panel.contentView ?? rootView
            surfaceView.wantsLayer = true
            surfaceView.layer?.add(collapse, forKey: "dismiss-collapse")
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = reduceMotion ? 0.09 : 0.17
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().alphaValue = 0
        } completionHandler: { [weak self] in
            guard let self, self.presentationGeneration == generation else { return }
            self.panel.orderOut(nil)
            self.panel.alphaValue = 1
            self.fluidView.setMode(.hidden, morphing: false)
        }
    }

    private func configurePanel() {
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.setAccessibilityLabel("VibeVoice 语音输入状态")
    }

    private func configureViews() {
        rootView.wantsLayer = true
        rootView.frame = NSRect(origin: .zero, size: panel.frame.size)
        rootView.autoresizingMask = [.width, .height]
        rootView.layer?.cornerRadius = 27
        rootView.layer?.cornerCurve = .continuous
        rootView.layer?.masksToBounds = true

        materialView.translatesAutoresizingMaskIntoConstraints = false
        materialView.material = .popover
        materialView.blendingMode = .behindWindow
        materialView.state = .active
        rootView.addSubview(materialView)

        fluidView.translatesAutoresizingMaskIntoConstraints = false
        rootView.addSubview(fluidView)

        symbolView.translatesAutoresizingMaskIntoConstraints = false
        symbolView.imageScaling = .scaleProportionallyDown
        symbolView.isHidden = true
        rootView.addSubview(symbolView)
        controls.orientation = .horizontal
        controls.spacing = 8
        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.isHidden = true
        func button(_ symbol: String, label: String, action: Selector) -> NSButton {
            let button = NSButton(image: NSImage(systemSymbolName: symbol, accessibilityDescription: label)!, target: self, action: action)
            button.bezelStyle = .rounded
            button.toolTip = label
            button.setAccessibilityLabel(label)
            controls.addArrangedSubview(button)
            return button
        }
        stopButton = button("stop.fill", label: "结束录音", action: #selector(stopPressed))
        cancelButton = button("xmark", label: "取消／关闭", action: #selector(cancelPressed))
        copyButton = button("doc.on.doc", label: "复制上次结果", action: #selector(copyPressed))
        rootView.addSubview(controls)
        rootView.hoverChanged = { [weak self] hovering in
            guard let self else { return }
            self.controls.isHidden = !hovering
            self.fluidView.alphaValue = hovering ? 0.15 : 1
            self.symbolView.alphaValue = hovering ? 0 : 1
        }

        NSLayoutConstraint.activate([
            controls.centerXAnchor.constraint(equalTo: rootView.centerXAnchor),
            controls.centerYAnchor.constraint(equalTo: rootView.centerYAnchor),
            materialView.leadingAnchor.constraint(equalTo: rootView.leadingAnchor),
            materialView.trailingAnchor.constraint(equalTo: rootView.trailingAnchor),
            materialView.topAnchor.constraint(equalTo: rootView.topAnchor),
            materialView.bottomAnchor.constraint(equalTo: rootView.bottomAnchor),

            fluidView.leadingAnchor.constraint(equalTo: rootView.leadingAnchor, constant: 14),
            fluidView.trailingAnchor.constraint(equalTo: rootView.trailingAnchor, constant: -14),
            fluidView.centerYAnchor.constraint(equalTo: rootView.centerYAnchor),
            fluidView.heightAnchor.constraint(equalToConstant: 32),

            symbolView.centerXAnchor.constraint(equalTo: rootView.centerXAnchor),
            symbolView.centerYAnchor.constraint(equalTo: rootView.centerYAnchor),
            symbolView.widthAnchor.constraint(equalToConstant: 15),
            symbolView.heightAnchor.constraint(equalToConstant: 15)
        ])

        panel.contentView = rootView
    }

    private func present(
        _ presentation: Presentation,
        audioLevelProvider: (() -> CGFloat)? = nil
    ) {
        presentationGeneration += 1
        scheduledDismiss?.cancel()
        scheduledDismiss = nil
        applyDisplayPreferences()
        transitionContent(to: presentation)
        startUpdates(for: presentation.mode, audioLevelProvider: audioLevelProvider)
        positionPanel()

        let surfaceView = panel.contentView ?? rootView
        surfaceView.layer?.removeAnimation(forKey: "dismiss-collapse")

        guard !panel.isVisible else {
            if panel.alphaValue < 1 {
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = reduceMotion ? 0.09 : 0.15
                    context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                    panel.animator().alphaValue = 1
                }
            }
            return
        }

        panel.alphaValue = 0
        panel.orderFrontRegardless()
        if !reduceMotion { addMaterializeAnimation() }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = reduceMotion ? 0.09 : 0.2
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
    }

    private func transitionContent(to presentation: Presentation) {
        controls.isHidden = true
        fluidView.alphaValue = 1
        symbolView.alphaValue = 1
        stopButton.isHidden = presentation.mode != .recording
        copyButton.isHidden = presentation.mode != .error && presentation.mode != .success
        let shouldMorph = panel.isVisible && !reduceMotion
        fluidView.setMode(presentation.mode, morphing: shouldMorph)

        if shouldMorph {
            symbolView.wantsLayer = true
            let transition = CATransition()
            transition.type = .fade
            transition.duration = 0.13
            transition.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            symbolView.layer?.add(transition, forKey: "symbol-change")
        }

        if let symbolName = presentation.symbolName {
            let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .bold)
            let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: presentation.accessibilityLabel)
            symbolView.image = image?.withSymbolConfiguration(configuration)
            symbolView.contentTintColor = fluidView.glassTintColor
            symbolView.isHidden = false
        } else {
            symbolView.isHidden = true
            symbolView.image = nil
        }

        if #available(macOS 26.0, *), let glassView = nativeGlassView as? NSGlassEffectView {
            // Clear glass should refract the desktop, not read as a dark filled capsule.
            glassView.tintColor = fluidView.glassTintColor.withAlphaComponent(0.012)
        }

        panel.setAccessibilityValue(presentation.accessibilityLabel)
        NSAccessibility.post(
            element: panel,
            notification: .announcementRequested,
            userInfo: [
                .announcement: presentation.accessibilityLabel,
                .priority: NSAccessibilityPriorityLevel.medium.rawValue
            ]
        )
    }

    private func applyDisplayPreferences() {
        let workspace = NSWorkspace.shared
        let reduceTransparency = workspace.accessibilityDisplayShouldReduceTransparency
        let increaseContrast = workspace.accessibilityDisplayShouldIncreaseContrast

        // The fluid is the interface. Keep the surrounding window genuinely clear;
        // native glass still darkens busy content even when using its clear style.
        installSurface(useNativeGlass: false)
        materialView.isHidden = true
        panel.hasShadow = reduceTransparency
        rootView.layer?.backgroundColor = reduceTransparency
            ? NSColor.windowBackgroundColor.withAlphaComponent(0.98).cgColor
            : NSColor.clear.cgColor
        rootView.layer?.borderWidth = reduceTransparency && increaseContrast ? 1 : 0
        rootView.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(
            increaseContrast ? 0.72 : 0.22
        ).cgColor
        fluidView.reduceMotion = reduceMotion
    }

    private func installSurface(useNativeGlass: Bool) {
        if #available(macOS 26.0, *), useNativeGlass {
            let glassView: NSGlassEffectView
            if let existing = nativeGlassView as? NSGlassEffectView {
                glassView = existing
            } else {
                glassView = NSGlassEffectView(frame: NSRect(origin: .zero, size: panel.frame.size))
                glassView.autoresizingMask = [.width, .height]
                glassView.cornerRadius = 27
                glassView.style = .clear
                if #available(macOS 27.0, *) {
                    glassView.effectIsInteractive = false
                }
                nativeGlassView = glassView
            }

            guard !usesNativeGlass else { return }
            glassView.frame = NSRect(origin: .zero, size: panel.frame.size)
            glassView.contentView = rootView
            panel.contentView = glassView
            usesNativeGlass = true
            return
        }

        guard usesNativeGlass else { return }
        if #available(macOS 26.0, *), let glassView = nativeGlassView as? NSGlassEffectView {
            glassView.contentView = nil
        }
        rootView.frame = NSRect(origin: .zero, size: panel.frame.size)
        panel.contentView = rootView
        usesNativeGlass = false
    }

    private func addMaterializeAnimation() {
        guard let surfaceView = panel.contentView else { return }
        surfaceView.wantsLayer = true

        let spring = CASpringAnimation(keyPath: "transform")
        spring.mass = 1
        spring.stiffness = 430
        spring.damping = 40
        spring.initialVelocity = 0
        spring.fromValue = NSValue(caTransform3D: CATransform3DMakeScale(0.62, 0.82, 1))
        spring.toValue = NSValue(caTransform3D: CATransform3DIdentity)
        spring.duration = min(spring.settlingDuration, 0.38)
        surfaceView.layer?.add(spring, forKey: "materialize")
    }

    private func positionPanel() {
        let screen = NSScreen.main ?? NSScreen.screens.first
        guard let visibleFrame = screen?.visibleFrame else { return }
        let panelFrame = panel.frame
        panel.setFrameOrigin(NSPoint(
            x: round(visibleFrame.midX - panelFrame.width / 2),
            y: round(visibleFrame.minY + 44)
        ))
    }

    private func startUpdates(
        for mode: FluidWaveView.Mode,
        audioLevelProvider: (() -> CGFloat)? = nil
    ) {
        stopUpdates()
        self.audioLevelProvider = audioLevelProvider
        guard mode != .hidden else { return }
        if reduceMotion && mode != .recording { return }

        let interval = reduceMotion ? (1.0 / 20.0) : (1.0 / 60.0)
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            guard let self else { return }
            let level = mode == .recording ? self.audioLevelProvider?() : nil
            self.fluidView.tick(audioLevel: level)
        }
        RunLoop.main.add(timer, forMode: .common)
        updateTimer = timer
    }

    private func stopUpdates() {
        updateTimer?.invalidate()
        updateTimer = nil
        audioLevelProvider = nil
    }

    private func dismiss(after delay: TimeInterval) {
        scheduledDismiss?.cancel()
        let item = DispatchWorkItem { [weak self] in
            self?.hide()
        }
        scheduledDismiss = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }
    @objc private func stopPressed() { onStop?() }
    @objc private func cancelPressed() { onCancel?(); hide() }
    @objc private func copyPressed() { onCopy?(); hide() }
}
