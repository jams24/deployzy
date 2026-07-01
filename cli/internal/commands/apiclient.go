package commands

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// apiBaseURL is the REST API base. Override with SERVERME_API_URL for self-hosted.
func apiBaseURL() string {
	if v := os.Getenv("SERVERME_API_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://api.deployzy.com"
}

// apiClient is a thin REST client for the deploy/project endpoints. It auths
// with the saved token: an sm_live_ key goes in X-API-Key, anything else (a JWT)
// goes in Authorization: Bearer.
type apiClient struct {
	base  string
	token string
	http  *http.Client
}

func newAPIClient() (*apiClient, error) {
	token := authToken // --authtoken global flag
	if token == "" {
		token = loadSavedToken()
	}
	if token == "" {
		return nil, fmt.Errorf("not authenticated — run `deployzy authtoken <key>` (create a key at https://deployzy.com/api-keys)")
	}
	return &apiClient{base: apiBaseURL(), token: token, http: &http.Client{Timeout: 60 * time.Second}}, nil
}

func (c *apiClient) auth(req *http.Request) {
	if strings.HasPrefix(c.token, "sm_live_") {
		req.Header.Set("X-API-Key", c.token)
	} else {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
}

// do issues a JSON request and decodes the response into out (may be nil).
func (c *apiClient) do(method, path string, body, out any) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		return err
	}
	c.auth(req)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Error == "" {
			e.Error = strings.TrimSpace(string(data))
		}
		return fmt.Errorf("%s (HTTP %d)", e.Error, resp.StatusCode)
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// uploadTar streams a gzip'd tar of dir to the project's upload endpoint.
func (c *apiClient) uploadTar(projectID, dir string) error {
	pr, pw := io.Pipe()
	go func() {
		pw.CloseWithError(writeDirTarGz(pw, dir))
	}()
	req, err := http.NewRequest("POST", c.base+"/api/v1/projects/"+projectID+"/upload", pr)
	if err != nil {
		return err
	}
	c.auth(req)
	req.Header.Set("Content-Type", "application/gzip")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upload failed (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return nil
}

// cliProject is the subset of the project JSON the CLI displays.
type cliProject struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Subdomain    string `json:"subdomain"`
	Status       string `json:"status"`
	Framework    string `json:"framework"`
	DeploySource string `json:"deploy_source"`
}

type cliLog struct {
	Message   string `json:"message"`
	Level     string `json:"level"`
	CreatedAt string `json:"created_at"`
}

// projectDetail matches GET /projects/{id} → {project, logs}.
type projectDetail struct {
	Project cliProject `json:"project"`
	Logs    []cliLog   `json:"logs"`
}

// resolveProject finds a project by id, name, or subdomain.
func (c *apiClient) resolveProject(ref string) (*cliProject, error) {
	var list []cliProject
	if err := c.do("GET", "/api/v1/projects", nil, &list); err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == ref || list[i].Name == ref || list[i].Subdomain == ref {
			return &list[i], nil
		}
	}
	return nil, fmt.Errorf("no project matching %q", ref)
}

// writeDirTarGz tars+gzips dir into w, skipping common build/VCS junk.
func writeDirTarGz(w io.Writer, dir string) error {
	gz := gzip.NewWriter(w)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	skip := map[string]bool{".git": true, "node_modules": true, ".next": true, "dist": true, ".deployzy": true}
	return filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		// Skip junk directories entirely.
		top := strings.SplitN(rel, string(filepath.Separator), 2)[0]
		if skip[top] {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(rel)
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
}
