package services

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

func (s *GeoBattleService) newRoomCodeLocked() (string, error) {
	for i := 0; i < 10; i++ {
		code, err := randomGeoBattleCode()
		if err != nil {
			return "", err
		}
		if _, exists := s.roomCodes[code]; !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("failed to allocate room code")
}

func newGeoBattleRoomID() (string, error) {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "room_" + hex.EncodeToString(buf), nil
}

func randomGeoBattleCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, geoBattleRoomCodeLength)
	randBytes := make([]byte, geoBattleRoomCodeLength)
	if _, err := rand.Read(randBytes); err != nil {
		return "", err
	}
	for i := range buf {
		buf[i] = alphabet[int(randBytes[i])%len(alphabet)]
	}
	return string(buf), nil
}

func normalizeGeoBattleRoomCode(code string) string {
	code = strings.TrimSpace(strings.ToUpper(code))
	if len(code) != geoBattleRoomCodeLength {
		return ""
	}
	for _, r := range code {
		if !unicode.IsDigit(r) && (r < 'A' || r > 'Z') {
			return ""
		}
	}
	return code
}

func normalizeGeoBattleNickname(nickname string) (string, error) {
	nickname = strings.TrimSpace(nickname)
	nickname = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, nickname)
	if nickname == "" || utf8.RuneCountInString(nickname) > geoBattleMaxNicknameRunes {
		return "", ErrGeoBattleInvalidNickname
	}
	return nickname, nil
}
