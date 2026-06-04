package com.example

class Greeter {
    fun greet() {
        val msg = build()
        println(msg)
    }

    fun build(): String {
        return "hi"
    }
}
