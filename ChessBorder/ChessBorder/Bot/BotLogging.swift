import Foundation
import os.log

enum BotLogging {
    private static let log = Logger(subsystem: "com.sahasraranjan.chessborder", category: "Bot")

    static func debug(_ message: String) {
        #if DEBUG
        log.debug("\(message, privacy: .public)")
        print("[Bot] \(message)")
        #endif
    }
}
