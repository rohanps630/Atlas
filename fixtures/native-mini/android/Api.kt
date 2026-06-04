package com.example

object ApiVersion {
    const val V1 = "api/v1"
}

object AuthRoutes {
    const val REGISTER = "${ApiVersion.V1}/auth/register"
}

interface AuthApi {
    @POST(AuthRoutes.REGISTER)
    fun register(): Unit
}
