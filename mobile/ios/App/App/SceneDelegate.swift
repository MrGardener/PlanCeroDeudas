import UIKit
import Capacitor
import LocalAuthentication
import Security

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    // Covers the app while it's in the app switcher, so amounts don't show in its snapshot.
    private var privacyCover: UIView?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()
        // Opened from the home-screen quick action: the page asks for it (DeviceKey.takeAction).
        if connectionOptions.shortcutItem?.type == DeviceKeyPlugin.quickType { DeviceKeyPlugin.pendingAction = "quick" }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        guard let window = window, privacyCover == nil else { return }
        let cover = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        cover.frame = window.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(cover)
        privacyCover = cover
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // Long-press the app icon → "Add expense" while the app is in the background.
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        if shortcutItem.type == DeviceKeyPlugin.quickType { DeviceKeyPlugin.pendingAction = "quick" }
        completionHandler(true)
    }
}

// Registers the app's own plugin with the bridge.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceKeyPlugin())
    }
}

// The phone's own lock for the plan (js/device.js):
// - getKey: a random 256-bit data key kept in the Keychain, on this iPhone only (not in backups,
//   not on other devices, readable only while unlocked). The plan is saved encrypted with it even
//   without a PIN.
// - Face ID / Touch ID unlock for the PIN lock: the PIN kept in the Keychain the same way, handed
//   back only after the phone confirms it's you (verify).
// - takeAction: the home-screen quick action the app was opened with ("quick": quick entry).
// Nothing here talks to a network.
@objc(DeviceKeyPlugin)
public class DeviceKeyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceKeyPlugin"
    public let jsName = "DeviceKey"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "canVerify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verify", returnType: CAPPluginReturnPromise)
    ]
    static let quickType = "com.zerodebtplan.quick"
    static var pendingAction: String?
    private let service = "com.zerodebtplan.devicekey"

    private func query(_ account: String) -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    private func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }
    private func write(_ account: String, _ data: Data) -> Bool {
        SecItemDelete(query(account) as CFDictionary)
        var q = query(account)
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    @objc func getKey(_ call: CAPPluginCall) {
        if let key = read("data-key") { call.resolve(["key": key.base64EncodedString()]); return }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess, write("data-key", Data(bytes)) else {
            call.reject("No device key")
            return
        }
        call.resolve(["key": Data(bytes).base64EncodedString()])
    }
    @objc func setSecret(_ call: CAPPluginCall) {
        if write("secret", Data((call.getString("value") ?? "").utf8)) { call.resolve() } else { call.reject("Not saved") }
    }
    // Only called by the app right after verify() succeeded.
    @objc func getSecret(_ call: CAPPluginCall) {
        if let data = read("secret"), let value = String(data: data, encoding: .utf8) { call.resolve(["value": value]) } else { call.resolve(["value": NSNull()]) }
    }
    @objc func clearSecret(_ call: CAPPluginCall) {
        SecItemDelete(query("secret") as CFDictionary)
        call.resolve()
    }
    // Forget everything (the 10th wrong PIN erases the app's data).
    @objc func clearAll(_ call: CAPPluginCall) {
        SecItemDelete(query("secret") as CFDictionary)
        SecItemDelete(query("data-key") as CFDictionary)
        call.resolve()
    }
    @objc func takeAction(_ call: CAPPluginCall) {
        let action = DeviceKeyPlugin.pendingAction
        DeviceKeyPlugin.pendingAction = nil
        if let action = action { call.resolve(["action": action]) } else { call.resolve(["action": NSNull()]) }
    }
    @objc func canVerify(_ call: CAPPluginCall) {
        var error: NSError?
        call.resolve(["available": LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)])
    }
    @objc func verify(_ call: CAPPluginCall) {
        let context = LAContext()
        context.localizedCancelTitle = call.getString("cancel") ?? "Use PIN"
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: call.getString("subtitle") ?? "Unlock") { ok, error in
            if ok { call.resolve() } else { call.reject(error?.localizedDescription ?? "Not verified") }
        }
    }
}
