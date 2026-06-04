package main

const prefix = "/api/"
const Version = "v1"
const BasePath = prefix + Version

func ListOrders() {
	save()
}

func save() {}

func routes(r chi.Router) {
	r.Route(BasePath, func(r chi.Router) {
		r.Route("/orders", func(r chi.Router) {
			r.Get("/", ListOrders)
			r.Get("/{id}", GetOrder)
		})
	})
}

func GetOrder() {}
