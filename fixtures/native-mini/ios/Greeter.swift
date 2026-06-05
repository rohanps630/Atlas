import Foundation

class Greeter {
    func greet() {
        let msg = build()   // bare call, same class → Greeter.build (scope)
        let o = Other()
        o.build()           // receiver bound to Other() → Other.build (receiver)
        print(msg)
    }

    func build() -> String {
        return "hi"
    }
}

// A second `build` makes the short name ambiguous repo-wide; the layers above
// must still pick the right one per call site (ADR 0012).
class Other {
    func build() -> String {
        return "other"
    }
}
