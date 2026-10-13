import AppKit
import AVFoundation
import ApplicationServices

private enum AppState {
    case loading, ready, requestingMicrophone, recording, transcribing, enhancing, completed, failed(String)
}


private final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var toggleItem: NSMenuItem!
    private var statusMenuItem: NSMenuItem!
    private var shortcutItem: NSMenuItem!
    private var hotKeyManager: HotKeyManager?
    private var shortcut = GlobalShortcut.load()
    private let recorder = AudioRecorder()
    private var server: any SpeechRecognizer = ASRServer()
    private var modelReady = false
    private let textPipeline = TextPipeline(backend: WritingProcessor())
    private let history = DictationHistory()
    private var settings = WritingSettings.load()
    private var sessionSettings = WritingSettings.load()
    private var target: InputTarget?
    private var processingTask: Task<Void, Never>?
    private var timeout: DispatchWorkItem?
    private var recordingLimit: DispatchWorkItem?
    private var livePollTimer: Timer?
    private var liveTranscription: LiveTranscriptionSession?
    private var sessionID = UUID()
    private var recognitionStarted = Date()
    private var recognitionSeconds = 0.0
    private var escapeMonitor: Any?
    private var localEscapeMonitor: Any?
    private var historyMenu = NSMenu()
    private var modeItems: [NSMenuItem] = []
    private let hud = VoiceHUDController()
    private var state: AppState = .loading {
        didSet {
            refreshMenu()
            refreshHUD()
        }
    }
    private var recordingURL: URL?


    private var projectRoot: URL {
        if let override = ProcessInfo.processInfo.environment["VIBEVOICE_PROJECT_ROOT"], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        let workingDirectory = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
        if FileManager.default.fileExists(
            atPath: workingDirectory.appendingPathComponent("runtime/VibeASR.cpp-main").path
        ) {
            return workingDirectory
        }
        return Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        settings = settings.usableAtLaunch()
        settings.save()
        buildMenu()
        installShortcut()
        startServer()
        hud.onCancel = { [weak self] in self?.cancelSession() }
        hud.onStop = { [weak self] in self?.toggleRecording() }
        hud.onCopy = { [weak self] in self?.copyLast() }
        escapeMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.cancelSession() }
        }
        localEscapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53, self?.isBusy == true { self?.cancelSession(); return nil }
            return event
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        hud.hide(animated: false)
        recorder.stop()
        server.stop()
        processingTask?.cancel()
        timeout?.cancel()
        recordingLimit?.cancel()
        livePollTimer?.invalidate()
        liveTranscription?.cancel()
        cleanupRecording()
        if let escapeMonitor { NSEvent.removeMonitor(escapeMonitor) }
        if let localEscapeMonitor { NSEvent.removeMonitor(localEscapeMonitor) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard !flag, !isBusy else { return false }
        DispatchQueue.main.async { [weak self] in self?.configureWriting() }
        return false
    }

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        setStatusIcon("waveform", fallback: "🎙")
        statusItem.button?.toolTip = "VibeVoice 本地语音输入"

        let menu = NSMenu()
        statusMenuItem = NSMenuItem(title: "正在载入模型…", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())
        toggleItem = NSMenuItem(title: "开始录音", action: #selector(toggleRecording), keyEquivalent: "")
        toggleItem.target = self
        menu.addItem(toggleItem)
        let cancel = NSMenuItem(title: "取消当前录音／处理（Esc）", action: #selector(cancelSession), keyEquivalent: "")
        cancel.target = self
        menu.addItem(cancel)
        shortcutItem = NSMenuItem(title: "快捷键：\(shortcut.displayName)…", action: #selector(configureShortcut), keyEquivalent: "")
        shortcutItem.target = self
        menu.addItem(shortcutItem)
        menu.addItem(.separator())
        for mode in WritingMode.allCases {
            let item = NSMenuItem(title: mode.title, action: #selector(selectMode(_:)), keyEquivalent: "")
            item.representedObject = mode.rawValue
            item.target = self
            modeItems.append(item)
            menu.addItem(item)
        }
        let configure = NSMenuItem(title: "文字整理与词典设置…", action: #selector(configureWriting), keyEquivalent: "")
        configure.target = self
        menu.addItem(configure)
        let copy = NSMenuItem(title: "复制上次结果", action: #selector(copyLast), keyEquivalent: "")
        copy.target = self
        menu.addItem(copy)
        let retry = NSMenuItem(title: "用当前模式重新处理上次口述", action: #selector(reprocessLast), keyEquivalent: "")
        retry.target = self
        menu.addItem(retry)
        let recent = NSMenuItem(title: "最近 50 条（点选复制）", action: nil, keyEquivalent: "")
        recent.submenu = historyMenu
        menu.addItem(recent)
        rebuildHistory()
        let permissionItem = NSMenuItem(title: "打开隐私权限设置…", action: #selector(openPrivacySettings), keyEquivalent: "")
        permissionItem.target = self
        menu.addItem(permissionItem)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)
        statusItem.menu = menu
        refreshMenu()
    }

    private func installShortcut() {
        do {
            try activateShortcut(shortcut)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func activateShortcut(_ shortcut: GlobalShortcut) throws {
        let manager = HotKeyManager(shortcut: shortcut) { [weak self] in
            self?.toggleRecording()
        }
        try manager.register()
        hotKeyManager = manager
    }

    private func startServer() {
        if server.isRunning {
            state = modelReady ? .ready : .loading
            return
        }
        modelReady = false
        let runtime = projectRoot.appendingPathComponent("runtime/VibeASR.cpp-main")
        let binary = runtime.appendingPathComponent("build/bin/asr_stream_server")
        let modelDir = runtime.appendingPathComponent("models/vibeasr")
        let vae = modelDir.appendingPathComponent("vibeasr-vae-encoder-i8_s.gguf")
        let lm = modelDir.appendingPathComponent("vibeasr-lm-i2_s-embed-q6_k.gguf")

        for url in [binary, vae, lm] where !FileManager.default.fileExists(atPath: url.path) {
            state = .failed("缺少文件：\(url.lastPathComponent)")
            return
        }
        let activeServer = server
        server.onReady = { [weak self, weak activeServer] in
            guard self?.server === activeServer else { return }
            self?.modelReady = true
            self?.state = .ready
        }
        server.onResult = { [weak self, weak activeServer] result in
            guard let self, self.server === activeServer else { return }
            if let liveTranscription = self.liveTranscription {
                liveTranscription.accept(result)
                return
            }
            guard case .transcribing = self.state else { return }
            self.timeout?.cancel()
            self.recognitionSeconds = Date().timeIntervalSince(self.recognitionStarted)
            switch result {
            case .success(let text): self.processText(text)
            case .failure(let error): self.cleanupRecording(); self.state = .failed(error.localizedDescription)
            }
        }
        server.onPartialResult = { [weak self] text in
            guard let self, case .transcribing = self.state else { return }
            self.hud.updatePartialTranscript(self.liveTranscription?.previewText(currentPartial: text) ?? text)
        }
        server.onExit = { [weak self, weak activeServer] message in
            guard self?.server === activeServer else { return }
            self?.modelReady = false
            self?.timeout?.cancel()
            guard case .loading = self?.state else { self?.state = .failed(message); return }
            self?.state = .failed(message)
        }
        do {
            try server.start(binary: binary, vae: vae, lm: lm)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    @objc private func toggleRecording() {
        switch state {
        case .ready:
            requestMicrophoneAndRecord()
        case .recording:
            recordingLimit?.cancel()
            recorder.stop()
            guard let url = recordingURL else { state = .ready; return }
            livePollTimer?.invalidate()
            livePollTimer = nil
            state = .transcribing
            recognitionStarted = Date()
            let id = sessionID
            let deadline = DispatchWorkItem { [weak self] in
                guard let self, self.sessionID == id else { return }
                self.cancelSession()
                self.state = .failed("识别超时，已停止处理；请缩短录音后重试")
            }
            timeout = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: deadline)
            do {
                let samples = try recorder.samples(at: url)
                if let liveTranscription {
                    liveTranscription.finish(samples: samples)
                } else {
                    try server.transcribe(url)
                }
            } catch {
                liveTranscription?.cancel()
                liveTranscription = nil
                state = .failed(error.localizedDescription)
            }
        case .completed:
            state = .ready
            requestMicrophoneAndRecord()
        case .failed:
            if modelReady, server.isRunning {
                state = .ready
                requestMicrophoneAndRecord()
                return
            }
            server.onExit = nil
            server.stop()
            server = ASRServer()
            state = .loading
            startServer()
        default:
            NSSound.beep()
        }
    }

    private func requestMicrophoneAndRecord() {
        if settings.mode.requiresBackend {
            do { _ = try settings.validatedURL() }
            catch { state = .failed(error.localizedDescription); return }
        }
        target = InputTarget.capture()
        if settings.mode == .edit && (target?.selectedText.isEmpty ?? true) {
            state = .failed("请先选中要修改的文字，再开始录音")
            return
        }
        sessionID = UUID()
        sessionSettings = settings
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            beginRecording()
        case .notDetermined:
            state = .requestingMicrophone
            let requestID = sessionID
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, self.sessionID == requestID else { return }
                    if granted {
                        self.beginRecording()
                    } else {
                        self.state = .failed("麦克风权限未开启；点击此处重试")
                    }
                }
            }
        case .denied, .restricted:
            state = .failed("请在系统设置中允许麦克风权限")
            NSSound.beep()
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                NSWorkspace.shared.open(url)
            }
        @unknown default:
            state = .failed("无法读取麦克风权限状态")
        }
    }

    private func beginRecording() {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("vibevoice-\(UUID().uuidString).wav")
        do {
            try recorder.start(at: url)
            recordingURL = url
            let id = sessionID
            let live = LiveTranscriptionSession { [weak self] segmentURL in
                guard let self, self.sessionID == id else { throw CancellationError() }
                try self.server.transcribe(segmentURL)
            }
            live.onFinished = { [weak self, weak live] result in
                guard let self, let live, self.liveTranscription === live, self.sessionID == id else { return }
                self.finishLiveTranscription(result)
            }
            liveTranscription = live
            let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
                self?.pollLiveTranscription()
            }
            RunLoop.main.add(timer, forMode: .common)
            livePollTimer = timer
            state = .recording
            let limit = DispatchWorkItem { [weak self] in
                guard let self, self.sessionID == id, case .recording = self.state else { return }
                self.toggleRecording()
            }
            recordingLimit = limit
            DispatchQueue.main.asyncAfter(deadline: .now() + 180, execute: limit)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func pollLiveTranscription() {
        guard case .recording = state,
              let url = recordingURL,
              let liveTranscription,
              let samples = try? recorder.samples(at: url),
              !samples.isEmpty else { return }
        liveTranscription.update(samples: samples)
    }

    private func finishLiveTranscription(_ result: TranscriptAssemblyResult) {
        timeout?.cancel()
        livePollTimer?.invalidate()
        livePollTimer = nil
        liveTranscription = nil
        recognitionSeconds = Date().timeIntervalSince(recognitionStarted)
        guard !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            cleanupRecording()
            state = .failed("没有识别到语音")
            return
        }
        processText(result.text)
    }

    private func paste(_ text: String) {
        do { try TextInsertion.insert(text, target: target) }
        catch { state = .failed(error.localizedDescription); return }
        state = .completed
        cleanupRecording()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self, case .completed = self.state else { return }
            self.state = .ready
        }
    }

    private func refreshMenu() {
        guard statusItem != nil else { return }
        shortcutItem?.title = "快捷键：\(shortcut.displayName)…"
        for item in modeItems { item.state = (item.representedObject as? String) == settings.mode.rawValue ? .on : .off }
        switch state {
        case .loading:
            setStatusIcon("hourglass", fallback: "⏳")
            statusMenuItem.title = "正在载入模型…"
            toggleItem.title = "请稍候"
            toggleItem.isEnabled = false
        case .ready:
            setStatusIcon("waveform", fallback: "🎙")
            statusMenuItem.title = "就绪 · \(shortcut.displayName) 开始录音"
            toggleItem.title = "开始录音（\(shortcut.displayName)）"
            toggleItem.isEnabled = true
        case .requestingMicrophone:
            setStatusIcon("mic.fill", fallback: "🎤")
            statusMenuItem.title = "请在系统弹窗中允许麦克风"
            toggleItem.title = "等待麦克风权限"
            toggleItem.isEnabled = false
        case .recording:
            setStatusIcon("record.circle", fallback: "●")
            statusMenuItem.title = "录音中 · 再按 \(shortcut.displayName) 结束"
            toggleItem.title = "结束并转写（\(shortcut.displayName)）"
            toggleItem.isEnabled = true
        case .transcribing:
            setStatusIcon("ellipsis.circle", fallback: "…")
            statusMenuItem.title = "正在本地转写…"
            toggleItem.title = "正在转写"
            toggleItem.isEnabled = false
        case .enhancing:
            setStatusIcon("sparkles", fallback: "…")
            statusMenuItem.title = "正在整理文字…"
            toggleItem.title = "正在整理"
            toggleItem.isEnabled = false
        case .completed:
            setStatusIcon("checkmark.circle", fallback: "✓")
            statusMenuItem.title = "已发送粘贴 · 结果已保留"
            toggleItem.title = "已完成"
            toggleItem.isEnabled = false
        case .failed(let message):
            setStatusIcon("exclamationmark.triangle", fallback: "!")
            statusMenuItem.title = message.replacingOccurrences(of: "\n", with: " ")
            toggleItem.title = "重试"
            toggleItem.isEnabled = true
        }
    }

    private func setStatusIcon(_ symbolName: String, fallback: String) {
        guard let button = statusItem?.button else { return }
        let configuration = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "VibeVoice 语音输入")?
            .withSymbolConfiguration(configuration) {
            image.isTemplate = true
            button.image = image
            button.title = ""
            button.imagePosition = .imageOnly
        } else {
            button.image = nil
            button.title = fallback
        }
    }

    private func refreshHUD() {
        switch state {
        case .loading, .ready:
            hud.hide()
        case .requestingMicrophone:
            hud.showRequestingPermission()
        case .recording:
            hud.showRecording { [weak self] in
                self?.recorder.normalizedLevel() ?? 0
            }
        case .transcribing, .enhancing:
            hud.showTranscribing()
        case .completed:
            hud.showSuccess()
        case .failed(let message):
            hud.showError(message)
        }
    }

    private var isBusy: Bool {
        switch state {
        case .requestingMicrophone, .recording, .transcribing, .enhancing: return true
        default: return false
        }
    }

    private func cleanupRecording() {
        if let recordingURL { try? FileManager.default.removeItem(at: recordingURL) }
        recordingURL = nil
    }

    @objc private func cancelSession() {
        guard isBusy else { return }
        let hadLiveASRWork = liveTranscription?.hasSubmittedWork ?? false
        sessionID = UUID()
        timeout?.cancel()
        recordingLimit?.cancel()
        livePollTimer?.invalidate()
        livePollTimer = nil
        processingTask?.cancel()
        recorder.stop()
        let wasTranscribing: Bool
        if case .transcribing = state { wasTranscribing = true } else { wasTranscribing = hadLiveASRWork }
        liveTranscription?.cancel()
        liveTranscription = nil
        if wasTranscribing {
            server.onExit = nil
            server.stop()
            server = ASRServer()
        }
        cleanupRecording()
        hud.hide()
        state = wasTranscribing ? .loading : .ready
        if wasTranscribing { startServer() }
    }

    private func processText(_ original: String, insert: Bool = true) {
        let id = sessionID
        let config = sessionSettings
        let selected = config.mode == .edit ? target?.selectedText ?? "" : ""
        let appName = target?.appName ?? ""
        cleanupRecording()
        state = .enhancing
        processingTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let start = Date()
            let result = await self.textPipeline.process(
                original,
                selected: selected,
                app: appName,
                settings: config
            )
            if Task.isCancelled { return }
            let output = result.finalText
            let failure = result.warning
            guard !Task.isCancelled, self.sessionID == id else { return }
            let entry = DictationEntry(original: original, result: output, mode: result.effectiveMode,
                                       status: failure ?? "结果已生成", recognitionSeconds: self.recognitionSeconds,
                                       processingSeconds: Date().timeIntervalSince(start),
                                       corrected: result.correctedText,
                                       command: result.command?.matchedPhrase)
            do { try self.history.add(entry) }
            catch {
                self.rebuildHistory()
                self.state = .failed("历史保存失败；本次结果仍在菜单中，请及时复制")
                return
            }
            self.rebuildHistory()
            if insert, result.shouldInsert { self.paste(output) }
            else if let failure { self.state = .failed(failure) }
            else { self.state = .failed("重新处理完成，请从菜单复制结果") }
        }
    }

    private func rebuildHistory() {
        historyMenu.removeAllItems()
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm"
        for entry in history.entries {
            let title = "\(formatter.string(from: entry.date))  \(entry.result.replacingOccurrences(of: "\n", with: " ").prefix(35))"
            let item = NSMenuItem(title: title, action: #selector(copyEntry(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = entry.result
            let command = entry.command.map { " · 口令 \($0)" } ?? ""
            item.toolTip = "\(entry.mode.title)\(command) · 识别 \(String(format: "%.1f", entry.recognitionSeconds))s · 整理 \(String(format: "%.1f", entry.processingSeconds))s\n\(entry.status)\n\(entry.result)"
            historyMenu.addItem(item)
        }
    }

    @objc private func copyEntry(_ item: NSMenuItem) {
        guard let text = item.representedObject as? String else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        if !isBusy { state = .ready }
    }
    @objc private func copyLast() {
        guard let entry = history.entries.first else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(entry.result, forType: .string)
        if !isBusy { state = .ready }
    }
    @objc private func reprocessLast() {
        guard !isBusy, modelReady, let entry = history.entries.first else { return }
        guard settings.mode != .edit else { state = .failed("编辑模式请重新选中文字并录音"); return }
        sessionID = UUID()
        sessionSettings = settings
        target = nil
        recognitionSeconds = 0
        processText(entry.original, insert: false)
    }
    @objc private func selectMode(_ item: NSMenuItem) {
        guard !isBusy else { return }
        guard let raw = item.representedObject as? String, let mode = WritingMode(rawValue: raw) else { return }
        if mode.requiresBackend, (try? settings.validatedURL()) == nil {
            configureWriting()
            guard (try? settings.validatedURL()) != nil else { return }
        }
        settings.mode = mode
        settings.save()
        refreshMenu()
    }

    @objc private func configureShortcut() {
        guard !isBusy else { return }
        let alert = NSAlert()
        alert.messageText = "设置全局录音快捷键"
        alert.informativeText = "点击下面的快捷键框，然后按下至少包含一个修饰键的新组合键。Esc 取消录制。"
        let recorder = ShortcutRecorderView(shortcut: shortcut)
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 58))
        recorder.frame = NSRect(x: 20, y: 7, width: 320, height: 44)
        view.addSubview(recorder)
        alert.accessoryView = view
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "取消")
        alert.addButton(withTitle: "恢复默认")
        NSApp.activate(ignoringOtherApps: true)

        let response = alert.runModal()
        guard response != .alertSecondButtonReturn else { return }
        let candidate = response == .alertThirdButtonReturn ? GlobalShortcut.default : recorder.shortcut
        guard candidate != shortcut else { return }

        let previous = shortcut
        hotKeyManager = nil
        do {
            try activateShortcut(candidate)
            shortcut = candidate
            shortcut.save()
            refreshMenu()
        } catch {
            try? activateShortcut(previous)
            let failure = NSAlert(error: error)
            failure.messageText = "无法保存快捷键"
            failure.runModal()
        }
    }

    @objc private func configureWriting() {
        guard !isBusy else { return }
        let alert = NSAlert()
        alert.messageText = "文字整理与个人词典"
        alert.informativeText = "原文和本地纠错模式完全本地。AI 整理、翻译和编辑模式会发送转写与词典；编辑模式还发送选中文字。普通整理失败会回退识别文字，翻译和编辑失败不会自动写入。"
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 440, height: 290))
        func field(_ title: String, value: String, y: CGFloat, secure: Bool = false) -> NSTextField {
            let label = NSTextField(labelWithString: title)
            label.frame = NSRect(x: 0, y: y + 28, width: 440, height: 20)
            view.addSubview(label)
            let input: NSTextField = secure ? NSSecureTextField() : NSTextField()
            input.stringValue = value
            input.frame = NSRect(x: 0, y: y, width: 440, height: 24)
            view.addSubview(input)
            return input
        }
        let endpoint = field("完整接口地址（https://…/v1/chat/completions）", value: settings.endpoint, y: 230)
        let model = field("模型名称", value: settings.model, y: 174)
        let key = field("API Key（留空保留已保存密钥）", value: "", y: 118, secure: true)
        let vocabulary = field("个人词典（词，或 正写=误写1|误写2；逗号分隔）", value: settings.vocabulary, y: 62)
        let context = NSButton(checkboxWithTitle: "将应用名称用于调整文风", target: nil, action: nil)
        context.frame = NSRect(x: 0, y: 22, width: 440, height: 24)
        context.state = settings.includeAppContext ? .on : .off
        view.addSubview(context)
        alert.accessoryView = view
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        var updated = settings
        updated.endpoint = endpoint.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.model = model.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.vocabulary = String(vocabulary.stringValue.prefix(6000))
        updated.includeAppContext = context.state == .on
        do {
            if !updated.endpoint.isEmpty || !updated.model.isEmpty { _ = try updated.validatedURL() }
            // Never carry a credential silently to a different endpoint.
            if !key.stringValue.isEmpty || updated.endpoint != settings.endpoint {
                try ModelCredential.save(key.stringValue)
            }
            settings = updated.usableAtLaunch()
            settings.save()
            state = modelReady ? .ready : .loading
        } catch { state = .failed(error.localizedDescription) }
    }

    @objc private func openPrivacySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
}

if CommandLine.arguments.contains("--check-accessibility") {
    let trusted = AXIsProcessTrusted()
    print(trusted ? "PASS: Accessibility permission is active" : "FAIL: Accessibility permission is not active")
    exit(trusted ? 0 : 1)
}

let app = NSApplication.shared
private var retainedDelegate: AppDelegate?
private var retainedPreviewHUD: VoiceHUDController?

if let previewFlag = CommandLine.arguments.firstIndex(of: "--preview-hud") {
    let previewState = CommandLine.arguments.indices.contains(previewFlag + 1)
        ? CommandLine.arguments[previewFlag + 1]
        : "recording"
    let startedAt = CACurrentMediaTime()
    let previewHUD = VoiceHUDController()
    retainedPreviewHUD = previewHUD
    app.setActivationPolicy(.accessory)
    DispatchQueue.main.async {
        switch previewState {
        case "transcribing":
            previewHUD.showTranscribing()
        case "success":
            previewHUD.showSuccess()
        case "error":
            previewHUD.showError("请检查麦克风权限")
        default:
            previewHUD.showRecording {
                let elapsed = CACurrentMediaTime() - startedAt
                return 0.12 + abs(sin(elapsed * 3.4)) * 0.72
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
            app.terminate(nil)
        }
    }
    app.run()
} else {
    let delegate = AppDelegate()
    retainedDelegate = delegate
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
