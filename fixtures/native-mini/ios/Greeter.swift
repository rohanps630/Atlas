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

    func zonk() {} // globally-unique method name (used by the external-receiver test)
}

// A second `build` makes the short name ambiguous repo-wide; the layers above
// must still pick the right one per call site (ADR 0012).
class Other {
    func build() -> String {
        return "other"
    }
}

// Receiver typing from a stored property and a function parameter (ADR 0016).
class Handler {
    let greeter: Greeter

    init(greeter: Greeter) {
        self.greeter = greeter
    }

    func run(other: Other, ctx: Context) {
        greeter.build() // field-typed receiver → Greeter.build
        other.build()   // param-typed receiver → Other.build
        ctx.zonk()       // ctx: Context (not a repo class) → external, no edge
    }
}
