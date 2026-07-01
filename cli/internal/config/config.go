package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Config represents the Deployzy CLI configuration file.
type Config struct {
	Server    string                   `yaml:"server"`
	AuthToken string                   `yaml:"authtoken"`
	LogLevel  string                   `yaml:"log_level"`
	Inspector string                   `yaml:"inspector_addr"`
	Tunnels   map[string]*TunnelEntry  `yaml:"tunnels"`
}

// TunnelEntry defines a single tunnel in the config file.
type TunnelEntry struct {
	Proto      string `yaml:"proto"`
	Addr       string `yaml:"addr"`
	Subdomain  string `yaml:"subdomain,omitempty"`
	Hostname   string `yaml:"hostname,omitempty"`
	RemotePort int    `yaml:"remote_port,omitempty"`
	Inspect    bool   `yaml:"inspect"`
	Auth       string `yaml:"auth,omitempty"`
}

// DefaultPath returns the default config file path.
func DefaultPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "deployzy.yml"
	}
	return filepath.Join(home, ".deployzy", "deployzy.yml")
}

// Load reads a config file from the given path.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// Defaults
	if cfg.Server == "" {
		cfg.Server = "localhost:8443"
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if cfg.Inspector == "" {
		cfg.Inspector = "127.0.0.1:4040"
	}

	return &cfg, nil
}

// WriteExample writes an example config file to the given path.
func WriteExample(path string) error {
	example := Config{
		Server:    "deployzy.com:8443",
		AuthToken: "your-auth-token-here",
		LogLevel:  "info",
		Inspector: "127.0.0.1:4040",
		Tunnels: map[string]*TunnelEntry{
			"webapp": {
				Proto:     "http",
				Addr:      "8080",
				Subdomain: "myapp",
				Inspect:   true,
			},
			"database": {
				Proto:      "tcp",
				Addr:       "5432",
				RemotePort: 54320,
			},
		},
	}

	data, err := yaml.Marshal(&example)
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}
