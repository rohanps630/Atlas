package main

// Cases for deeper receiver typing (ADR 0015). `save` is ambiguous repo-wide
// (free save() + Repo.save), and `Process` is ambiguous (Order + Worker), so
// these only resolve correctly if the receiver's type is inferred.

type Order struct{}

func (o *Order) Process() {}

type Worker struct{}

func (w *Worker) Process() {} // makes Process ambiguous

func makeRepo() *Repo { return &Repo{} } // result type drives `r := makeRepo()`

var conn *Conn // package-level var of a NON-repo type (Conn is never declared)

func (s *Server) more() {
	r := makeRepo() // return-type inference → r : Repo
	r.save()        // → Repo.save (receiver), not the free save()

	orders := []Order{}
	for _, o := range orders { // range element → o : Order
		o.Process() // → Order.Process, not Worker.Process
	}
}

func (s *Server) ping() {
	conn.save() // conn is *Conn (external type) → external call, no edge
}
