import Foundation

class Greeter {
    func greet() {
        let msg = build()
        print(msg)
    }

    func build() -> String {
        return "hi"
    }
}
