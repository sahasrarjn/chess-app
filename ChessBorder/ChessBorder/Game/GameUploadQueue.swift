import Foundation

/// Pending cloud uploads for finished bot/local games (signed-in users only).
/// One shared mechanism: game end enqueues + flushes; launch flushes leftovers.
enum GameUploadQueue {
    static let key = "chessborder.pendingGameUploads"
    private static let maxPending = 10

    /// Reentrancy guard — safe because all entry points are @MainActor.
    private static var isFlushing = false

    static func load(defaults: UserDefaults = .standard) -> [CompletedGameRecord] {
        guard let data = defaults.data(forKey: key),
              let records = try? JSONDecoder().decode([CompletedGameRecord].self, from: data)
        else { return [] }
        return records
    }

    private static func save(_ records: [CompletedGameRecord], defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(records) else { return }
        defaults.set(data, forKey: key)
    }

    /// Remove all queued uploads (call on sign-out to prevent cross-user leakage).
    @MainActor
    static func clearQueue(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }

    /// Queue and immediately attempt upload. No-ops for guests, online games,
    /// or unconfigured accounts. Never throws, never blocks the caller.
    @MainActor
    static func enqueueAndFlush(_ record: CompletedGameRecord, defaults: UserDefaults = .standard) {
        guard record.mode != "online",
              AccountsConfig.isConfigured,
              AuthStore.shared.sessionToken != nil else { return }
        var queue = load(defaults: defaults)
        queue.append(record)
        if queue.count > maxPending { queue.removeFirst(queue.count - maxPending) }
        save(queue, defaults: defaults)
        Task { await flush(defaults: defaults) }
    }

    /// Drain in order. Success or HTTP 400 (permanently invalid) removes the
    /// entry; 401/network errors stop and keep the rest for the next launch.
    /// Concurrent calls coalesce: a second call while a flush is in progress
    /// returns immediately.
    @MainActor
    static func flush(defaults: UserDefaults = .standard) async {
        guard !isFlushing else { return }
        isFlushing = true
        defer { isFlushing = false }

        guard let url = AccountsConfig.serverURL,
              let token = AuthStore.shared.sessionToken else { return }
        let api = AccountsAPI(baseURL: url)
        var queue = load(defaults: defaults)
        while let next = queue.first {
            do {
                _ = try await api.postGame(token: token, record: next)
                queue.removeFirst()
            } catch AccountsAPIError.http(400) {
                queue.removeFirst()
            } catch {
                break
            }
            save(queue, defaults: defaults)
        }
        save(queue, defaults: defaults)
    }
}
