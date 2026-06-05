package main

// `save` here collides with the package-level func save() in main.go, so the
// short name "save" is ambiguous repo-wide — the pre-ADR-0012 resolver skipped
// every call to it. The scope/receiver layers disambiguate the cases below.

type Repo struct{}

func (r *Repo) save() {}

type Server struct {
	repo *Repo
}

func (s *Server) handle() {
	s.repo.save() // receiver/struct-field chain → Repo.save (NOT the free save())
	helper()      // bare call, unique in the package → helper()
}

func helper() {}

func (s *Server) mystery(x Unknown) {
	x.save() // x's type isn't a known struct → "save" stays ambiguous → no edge
}
