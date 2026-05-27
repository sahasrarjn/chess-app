import Foundation

#if os(macOS)
final class UCIProcessClient: @unchecked Sendable {
    private let process: Process
    private let input: FileHandle
    private var lines: [String] = []
    private let lock = NSLock()
    private var readerTask: Task<Void, Never>?

    init(binaryURL: URL) throws {
        let proc = Process()
        proc.executableURL = binaryURL
        proc.currentDirectoryURL = binaryURL.deletingLastPathComponent()
        let pipeIn = Pipe()
        let pipeOut = Pipe()
        proc.standardInput = pipeIn
        proc.standardOutput = pipeOut
        proc.standardError = pipeOut
        try proc.run()
        process = proc
        input = pipeIn.fileHandleForWriting

        let handle = pipeOut.fileHandleForReading
        readerTask = Task {
            var buffer = ""
            while !Task.isCancelled {
                let data = handle.availableData
                if data.isEmpty {
                    try? await Task.sleep(nanoseconds: 5_000_000)
                    continue
                }
                guard let chunk = String(data: data, encoding: .utf8) else { continue }
                buffer += chunk
                while let idx = buffer.firstIndex(of: "\n") {
                    let line = String(buffer[..<idx]).trimmingCharacters(in: .whitespacesAndNewlines)
                    buffer.removeSubrange(buffer.startIndex..<buffer.index(after: idx))
                    if !line.isEmpty {
                        lock.lock()
                        lines.append(line)
                        lock.unlock()
                    }
                }
            }
        }
    }

    func bootstrap() async throws {
        try await send("uci")
        _ = await waitForLine(containing: "uciok", timeout: 15)
        try await send("isready")
        _ = await waitForLine(containing: "readyok", timeout: 15)
    }

    func send(_ command: String) async throws {
        let payload = Data("\(command)\n".utf8)
        try input.write(contentsOf: payload)
    }

    func waitForLine(containing needle: String, timeout: TimeInterval) async -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let line = dequeueLine(containing: needle) {
                return line
            }
            try? await Task.sleep(nanoseconds: 15_000_000)
        }
        return nil
    }

    func discardPendingOutput() {
        lock.lock()
        lines.removeAll()
        lock.unlock()
    }

    private func dequeueLine(containing needle: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let idx = lines.firstIndex(where: { $0.contains(needle) }) else { return nil }
        return lines.remove(at: idx)
    }

    deinit {
        readerTask?.cancel()
        try? input.write(contentsOf: Data("quit\n".utf8))
        process.terminate()
    }
}
#endif

#if os(iOS) && targetEnvironment(simulator)
import Darwin

/// iOS Simulator can spawn bundled engine binaries via posix_spawn (Process is macOS-only).
final class UCISpawnClient: @unchecked Sendable {
    private let stdinWrite: FileHandle
    private let stdoutRead: FileHandle
    private var lines: [String] = []
    private let lock = NSLock()
    private var readerTask: Task<Void, Never>?
    private var childPID: pid_t = 0

    init(binaryURL: URL) throws {
        var inPipe: [Int32] = [0, 0]
        var outPipe: [Int32] = [0, 0]
        guard pipe(&inPipe) == 0, pipe(&outPipe) == 0 else {
            throw NSError(domain: "UCISpawnClient", code: 1)
        }

        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }

        posix_spawn_file_actions_adddup2(&actions, inPipe[0], STDIN_FILENO)
        posix_spawn_file_actions_addclose(&actions, inPipe[1])
        posix_spawn_file_actions_adddup2(&actions, outPipe[1], STDOUT_FILENO)
        posix_spawn_file_actions_adddup2(&actions, outPipe[1], STDERR_FILENO)
        posix_spawn_file_actions_addclose(&actions, outPipe[0])

        var pid: pid_t = 0
        let path = binaryURL.path
        var spawnError: Int32 = 0
        path.withCString { cPath in
            var argv: [UnsafeMutablePointer<CChar>?] = [UnsafeMutablePointer(mutating: cPath), nil]
            spawnError = posix_spawn(&pid, cPath, &actions, nil, &argv, environ)
        }
        close(inPipe[0])
        close(outPipe[1])

        guard spawnError == 0 else {
            close(inPipe[1])
            close(outPipe[0])
            throw NSError(domain: "UCISpawnClient", code: Int(spawnError))
        }

        childPID = pid
        stdinWrite = FileHandle(fileDescriptor: inPipe[1])
        stdoutRead = FileHandle(fileDescriptor: outPipe[0])

        let handle = stdoutRead
        readerTask = Task {
            var buffer = ""
            while !Task.isCancelled {
                let data = handle.availableData
                if data.isEmpty {
                    try? await Task.sleep(nanoseconds: 5_000_000)
                    continue
                }
                guard let chunk = String(data: data, encoding: .utf8) else { continue }
                buffer += chunk
                while let idx = buffer.firstIndex(of: "\n") {
                    let line = String(buffer[..<idx]).trimmingCharacters(in: .whitespacesAndNewlines)
                    buffer.removeSubrange(buffer.startIndex..<buffer.index(after: idx))
                    if !line.isEmpty {
                        lock.lock()
                        lines.append(line)
                        lock.unlock()
                    }
                }
            }
        }
    }

    func bootstrap() async throws {
        try await send("uci")
        _ = await waitForLine(containing: "uciok", timeout: 15)
        try await send("isready")
        _ = await waitForLine(containing: "readyok", timeout: 15)
    }

    func send(_ command: String) async throws {
        let payload = Data("\(command)\n".utf8)
        try stdinWrite.write(contentsOf: payload)
    }

    func waitForLine(containing needle: String, timeout: TimeInterval) async -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let line = dequeueLine(containing: needle) {
                return line
            }
            try? await Task.sleep(nanoseconds: 15_000_000)
        }
        return nil
    }

    func discardPendingOutput() {
        lock.lock()
        lines.removeAll()
        lock.unlock()
    }

    private func dequeueLine(containing needle: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let idx = lines.firstIndex(where: { $0.contains(needle) }) else { return nil }
        return lines.remove(at: idx)
    }

    deinit {
        readerTask?.cancel()
        try? stdinWrite.write(contentsOf: Data("quit\n".utf8))
        if childPID > 0 {
            kill(childPID, SIGTERM)
        }
    }
}
#endif
