package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type pkg struct {
	os   string
	arch string
	ext  string
}

type ReaderAtCloser interface {
	io.ReaderAt
	io.Reader
	io.Closer
}

func main() {
	nodeArches := map[string]string{
		"windows": "win",
		"darwin":  "darwin",
		"linux":   "linux",
		"amd64":   "x64",
		"386":     "x86",
		"armv7":   "armv7l",
		"armv6":   "armv6l",
		"armv8":   "arm64",
	}

	pkgs := []pkg{
		pkg{os: "darwin", arch: "amd64", ext: "tar.gz"},
		pkg{os: "windows", arch: "amd64", ext: "zip"},
		pkg{os: "windows", arch: "386", ext: "zip"},
		pkg{os: "linux", arch: "amd64", ext: "tar.gz"},
		pkg{os: "linux", arch: "armv8", ext: "tar.gz"},
		pkg{os: "linux", arch: "armv7", ext: "tar.gz"},
		pkg{os: "linux", arch: "armv6", ext: "tar.gz"},
	}

	nodev := "10.16.0"
	release := "stable"

	// temp file for the zip
	// TODO use mktemp
	f, err := os.OpenFile(fmt.Sprintf("telebit-%s.zip", release), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if nil != err {
		panic(err)
	}

	// get from trusted git source
	turl := fmt.Sprintf("https://git.rootprojects.org/root/telebit.js/archive/%s.zip", release)
	resp, err := http.Get(turl)
	if nil != err {
		panic(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 || resp.StatusCode < 200 {
		log.Fatal("Bad deal on telebit download:", resp.Status)
	}

	_, err = io.Copy(f, resp.Body)
	if nil != err {
		panic(err)
	}
	err = f.Sync()
	if nil != err {
		panic(err)
	}

	for i := range pkgs {
		pkg := pkgs[i]

		// Create a fresh directory for this telebit release
		outdir := fmt.Sprintf("telebit-%s-%s-%s", release, pkg.os, pkg.arch)
		fmt.Printf("Cutting a fresh release for %s\n", outdir)
		err := os.RemoveAll(outdir)
		if nil != err {
			panic(err)
		}

		nos := nodeArches[pkg.os]
		narch := nodeArches[pkg.arch]

		// Grab the node files
		npath := fmt.Sprintf("node-v%s-%s-%s", nodev, nos, narch)
		nfile := fmt.Sprintf("%s.%s", npath, pkg.ext)
		// TODO check remote filesize anyway as a quick sanity check
		if _, err := os.Stat(nfile); nil != err {
			// doesn't exist, go grab it
			fmt.Printf("Downloading node package %s\n", nfile)
			nurl := fmt.Sprintf("https://nodejs.org/download/release/v%s/%s", nodev, nfile)
			resp, err := http.Get(nurl)
			if nil != err {
				panic(err)
			}
			if resp.StatusCode >= 300 || resp.StatusCode < 200 {
				log.Fatal("Bad deal on node download:", resp.Status)
			}
			defer resp.Body.Close()

			// Stream it in locally
			fmt.Printf("Streaming node package %s\n", nfile)
			nf, err := os.OpenFile(nfile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
			_, err = io.Copy(nf, resp.Body)
			if nil != err {
				panic(err)
			}
			err = nf.Sync()
			if nil != err {
				panic(err)
			}
		}

		// lay down the node directory first
		fmt.Printf("Unpacking %s %s\n", nfile, pkg.ext)
		switch pkg.ext {
		case "zip":
			z, err := os.Open(nfile)
			if nil != err {
				panic(err)
			}
			s, err := z.Stat()
			if nil != err {
				panic(err)
			}
			strip := 1
			err = unzip(z, s.Size(), outdir, strip)
			if nil != err {
				panic(err)
			}
		case "tar.gz":
			tgz, err := os.Open(nfile)
			if nil != err {
				panic(err)
			}
			strip := 1
			err = untar(tgz, outdir, strip)
			if nil != err {
				panic(err)
			}
		default:
			panic(fmt.Errorf("Liar!!"))
		}

		// TODO how to handle node modules?
		// overlay our stuff on top of the node release package
		z, err := os.Open(fmt.Sprintf("telebit-%s.zip", release))
		fmt.Printf("Overlaying %s\n", outdir)
		if nil != err {
			panic(err)
		}
		defer z.Close()

		s, err := z.Stat()
		if nil != err {
			panic(err)
		}
		strip := 1
		if err := unzip(z, s.Size(), outdir, strip); nil != err {
			panic(err)
		}
	}

	fmt.Printf("Done.\n")
}

func untar(tgz io.Reader, outdir string, strip int) error {
	t, err := gzip.NewReader(tgz)
	if nil != err {
		return err
	}
	defer t.Close()
	tr := tar.NewReader(t)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if nil != err {
			return err
		}

		fpath := stripPrefix(header.Name, strip)
		fpath = filepath.Join(outdir, fpath)
		switch header.Typeflag {
		case tar.TypeLink:
			// ignore hard links
		case tar.TypeSymlink:
			// Note: the link itself is always a file, even when it represents a directory
			lpath := filepath.Join(filepath.Dir(fpath), header.Linkname)
			if !strings.HasPrefix(lpath+string(os.PathSeparator), outdir+string(os.PathSeparator)) {
				return fmt.Errorf("Malicious link path: %s", header.Linkname)
			}
			if err := os.Symlink(header.Linkname, fpath); nil != err {
				return err
			}
		case tar.TypeDir:
			// gonna use the same perms as were set previously here
			// should be fine (i.e. we want 755 for execs on *nix)
			_, err := safeOpen(header.FileInfo(), os.FileMode(header.Mode), fpath, outdir)
			if nil != err {
				return err
			}
		case tar.TypeReg:
			// gonna use the same perms as were set previously here
			// should be fine (i.e. we want 755 for execs on *nix)
			out, err := safeOpen(header.FileInfo(), os.FileMode(header.Mode), fpath, outdir)
			if nil != err {
				return err
			}
			defer out.Close()
			_, err = io.Copy(out, tr)
			if nil != err {
				return err
			}
			err = out.Close()
			if nil != err {
				return err
			}
		default:
			fmt.Printf("[debug] odd type %s (%c)", fpath, header.Typeflag)
		}
	}
	return nil
}

func unzip(z io.ReaderAt, size int64, outdir string, strip int) error {
	zr, err := zip.NewReader(z, size)
	if nil != err {
		return err
	}

	for i := range zr.File {
		f := zr.File[i]

		fpath := stripPrefix(f.Name, strip)
		fpath = filepath.Join(outdir, fpath)
		out, err := safeOpen(f.FileInfo(), f.Mode(), fpath, outdir)
		if nil != err {
			return err
		}
		if f.FileInfo().IsDir() {
			continue
		}
		// this is actually function scope (not loop scope)
		defer out.Close()

		zf, err := f.Open()
		if nil != err {
			return err
		}
		defer zf.Close()

		_, err = io.Copy(out, zf)
		if nil != err {
			return err
		}

		// close explicitly within loop scope
		err = out.Close()
		if nil != err {
			return err
		}
		err = zf.Close()
		if nil != err {
			return err
		}
	}
	return nil
}

func stripPrefix(fpath string, strip int) string {
	// /foo/bar/baz/ => foo/bar/baz
	// strip 1 => bar/baz
	fpath = strings.Trim(filepath.ToSlash(fpath), "/")
	parts := []string{}
	if "" != fpath {
		parts = strings.Split(fpath, "/")
	}
	if strip > 0 {
		n := len(parts)
		if strip > n {
			strip = n
		}
		if 0 != len(parts) {
			parts = parts[strip:]
		}
	}

	return strings.Join(parts, "/")
}

// given the path return a file, tell that it's a directory, or error out
func safeOpen(fi os.FileInfo, fm os.FileMode, fpath string, outdir string) (io.WriteCloser, error) {
	// Keep it clean
	// https://github.com/snyk/zip-slip-vulnerability
	cleanpath, _ := filepath.Abs(filepath.Clean(fpath))
	cleandest, _ := filepath.Abs(filepath.Clean(outdir))

	// foo/ foo => foo// foo/
	// foo/ foo/bar.md => foo// foo/bar.md/
	if !strings.HasPrefix(cleanpath+string(os.PathSeparator), cleandest+string(os.PathSeparator)) {
		return nil, fmt.Errorf("Malicious file path: %s", fpath)
	}
	fpath = cleanpath

	if fi.IsDir() {
		err := os.MkdirAll(fpath, fm)
		if nil != err {
			return nil, err
		}
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(fpath), 0755); nil != err {
		return nil, err
	}

	out, err := os.OpenFile(fpath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fm)
	if err != nil {
		return nil, err
	}

	return out, nil
}
