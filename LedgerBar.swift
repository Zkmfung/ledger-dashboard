// 记账菜单栏 App：点一下菜单栏上的金额，直接弹出迷你看板。
//
// The popover is a WKWebView showing the same encrypted dashboard page (in "?app" mode).
// The page decrypts itself with the password this app copies from the macOS Keychain
// (service "ledger-dashboard") into its localStorage, and posts this month's total back
// through the "ledger" message handler, which becomes the menu bar title.
//
// Built on the Mac by install-mac.sh with the Command Line Tools' swiftc; no Xcode project.
// Right-click the menu bar item for 刷新 / 在浏览器打开 / 退出.

import AppKit
import WebKit

let dashboardURL = URL(string: ProcessInfo.processInfo.environment["LEDGER_DASHBOARD_URL"]
                       ?? "https://zkmfung.github.io/ledger-dashboard/")!
let popoverSize = NSSize(width: 380, height: 640)

func keychainPassword() -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
    p.arguments = ["find-generic-password", "-s", "ledger-dashboard", "-w"]
    let out = Pipe()
    p.standardOutput = out
    p.standardError = Pipe()
    do { try p.run() } catch { return nil }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    guard p.terminationStatus == 0,
          let s = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !s.isEmpty else { return nil }
    return s
}

/// A JavaScript string literal for `s`.
func jsString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s])
    let array = String(data: data, encoding: .utf8)!  // ["..."]
    return String(array.dropFirst().dropLast())
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var item: NSStatusItem!
    let popover = NSPopover()
    var web: WKWebView!
    var loadedAt = Date.distantPast

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            let image = NSImage(systemSymbolName: "yensign.circle", accessibilityDescription: "记账")
            image?.isTemplate = true
            button.image = image
            button.imagePosition = .imageLeading
            button.title = " …"
            button.target = self
            button.action = #selector(clicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        let content = WKUserContentController()
        content.add(self, name: "ledger")
        if let pw = keychainPassword() {
            let js = "try { localStorage.setItem('ledger-dashboard-pw', \(jsString(pw))); } catch (e) {}"
            content.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let config = WKWebViewConfiguration()
        config.userContentController = content
        web = WKWebView(frame: NSRect(origin: .zero, size: popoverSize), configuration: config)
        web.setValue(false, forKey: "drawsBackground")  // let the popover's own material show through

        let controller = NSViewController()
        controller.view = web
        popover.contentViewController = controller
        popover.contentSize = popoverSize
        popover.behavior = .transient
        popover.animates = true

        reload()
        Timer.scheduledTimer(timeInterval: 30 * 60, target: self, selector: #selector(refresh),
                             userInfo: nil, repeats: true)
    }

    func reload() {
        var parts = URLComponents(url: dashboardURL, resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "app", value: nil)]
        web.load(URLRequest(url: parts.url!, cachePolicy: .reloadIgnoringLocalCacheData))
        loadedAt = Date()
    }

    @objc func clicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
        } else if popover.isShown {
            popover.performClose(sender)
        } else {
            if Date().timeIntervalSince(loadedAt) > 10 * 60 { reload() }
            popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func showMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: "刷新", action: #selector(refresh), keyEquivalent: "r").target = self
        menu.addItem(withTitle: "在浏览器打开", action: #selector(openInBrowser), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出记账", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    @objc func refresh() { reload() }

    @objc func openInBrowser() { NSWorkspace.shared.open(dashboardURL) }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let title = body["title"] as? String {
            item.button?.title = " " + title
        } else if body["locked"] != nil {
            item.button?.title = " 🔒"
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
