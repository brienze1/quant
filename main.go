package main

import (
	"embed"
	"log"

	"quant/internal/infra"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed changelog.json
var changelogData []byte

func main() {
	err := infra.Run(assets, changelogData)
	if err != nil {
		log.Fatal(err)
	}
}
