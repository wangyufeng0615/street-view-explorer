package utils

import (
	"net"
	"testing"
	"time"
)

func TestCheckTCPConnectionSupportsIPv6(t *testing.T) {
	listener, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skipf("IPv6 loopback is unavailable: %v", err)
	}
	defer listener.Close()

	address := listener.Addr().(*net.TCPAddr)
	accepted := make(chan error, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if conn != nil {
			_ = conn.Close()
		}
		accepted <- acceptErr
	}()

	if err := CheckTCPConnection(address.IP.String(), address.Port, time.Second); err != nil {
		t.Fatalf("CheckTCPConnection() error = %v", err)
	}

	select {
	case err := <-accepted:
		if err != nil {
			t.Fatalf("accept error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for IPv6 connection")
	}
}

func TestRedactProxyURL(t *testing.T) {
	cases := map[string]string{
		"http://user:secret@127.0.0.1:10086": "http://127.0.0.1:10086",
		"socks5://user@proxy.example:1080":   "socks5://proxy.example:1080",
		"http://127.0.0.1:10086":             "http://127.0.0.1:10086",
		"http://user:secret@bad host:1":      "<redacted>@bad host:1",
	}
	for input, want := range cases {
		if got := RedactProxyURL(input); got != want {
			t.Fatalf("RedactProxyURL(%q) = %q, want %q", input, got, want)
		}
	}
}
