package com.example

class Greeter {
    fun greet() {
        val msg = build()   // bare call, same class → Greeter.build (scope)
        val o = Other()
        o.build()           // receiver bound to Other() → Other.build (receiver)
        println(msg)
    }

    fun build(): String {
        return "hi"
    }

    fun zonk() {} // globally-unique method name (used by the external-receiver test)
}

// A second `build` makes the short name ambiguous repo-wide; the layers above
// must still pick the right one per call site (ADR 0012).
class Other {
    fun build(): String {
        return "other"
    }
}

// Receiver typing from a class field and a function parameter (ADR 0016).
class Handler(private val greeter: Greeter) {
    fun run(other: Other, ctx: Context) {
        greeter.build() // field-typed receiver → Greeter.build
        other.build()   // param-typed receiver → Other.build
        ctx.zonk()       // ctx: Context (not a repo class) → external, no edge
    }
}
