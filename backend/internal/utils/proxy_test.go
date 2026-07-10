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
