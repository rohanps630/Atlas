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
}

// A second `build` makes the short name ambiguous repo-wide; the layers above
// must still pick the right one per call site (ADR 0012).
class Other {
    fun build(): String {
        return "other"
    }
}
