package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// Browser events are relayed with the server's OpenAI key, so only the event
// shapes the Atlas Voice frontend actually sends are forwarded. Everything is
// re-encoded from a decoded map so duplicate JSON keys cannot smuggle a
// different event type past the checks.
const (
	realtimeMaxInstructionsRunes   = 16000
	realtimeMaxToolBytes           = 8 << 10
	realtimeMaxInputTextRunes      = 4000
	realtimeMaxFunctionOutputBytes = 64 << 10
	realtimeMaxLoggedClientEvents  = 5
)

var realtimeAllowedToolNames = map[string]bool{
	"navigate":           true,
	"look_direction":     true,
	"read_current_place": true,
}

var realtimeAllowedToolChoices = map[string]bool{
	"auto":     true,
	"none":     true,
	"required": true,
}

type realtimeRawObject map[string]json.RawMessage

// sanitizeRealtimeClientEvent returns the event to forward upstream. A non-nil
// error means the event must be dropped; a non-empty note means fields were
// removed or clamped and the change should be logged.
func sanitizeRealtimeClientEvent(payload []byte) (out []byte, eventType string, note string, err error) {
	var event realtimeRawObject
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, "", "", errors.New("invalid_json")
	}
	eventType, ok := rawJSONStringValue(event["type"])
	if !ok || eventType == "" {
		return nil, "", "", errors.New("missing_type")
	}

	var sanitized realtimeRawObject
	var notes []string
	switch eventType {
	case "input_audio_buffer.append":
		if _, ok := rawJSONStringValue(event["audio"]); !ok {
			return nil, eventType, "", errors.New("audio_not_string")
		}
		sanitized, notes = keepRealtimeFields(event, "type", "event_id", "audio")
	case "conversation.item.delete":
		if _, ok := rawJSONStringValue(event["item_id"]); !ok {
			return nil, eventType, "", errors.New("item_id_not_string")
		}
		sanitized, notes = keepRealtimeFields(event, "type", "event_id", "item_id")
	case "conversation.item.truncate":
		sanitized, notes = keepRealtimeFields(event, "type", "event_id", "item_id", "content_index", "audio_end_ms")
	case "response.create":
		// The frontend never overrides response parameters; dropping them keeps
		// per-response instructions/tools out of the client's control.
		sanitized, notes = keepRealtimeFields(event, "type", "event_id")
	case "conversation.item.create":
		sanitized, notes, err = sanitizeRealtimeItemCreate(event)
	case "session.update":
		sanitized, notes, err = sanitizeRealtimeSessionUpdate(event)
	default:
		return nil, eventType, "", errors.New("event_type_not_allowed")
	}
	if err != nil {
		return nil, eventType, "", err
	}

	out, err = json.Marshal(sanitized)
	if err != nil {
		return nil, eventType, "", errors.New("encode_failed")
	}
	return out, eventType, strings.Join(notes, ","), nil
}

func sanitizeRealtimeItemCreate(event realtimeRawObject) (realtimeRawObject, []string, error) {
	sanitized, notes := keepRealtimeFields(event, "type", "event_id", "previous_item_id", "item")
	var item realtimeRawObject
	if err := json.Unmarshal(event["item"], &item); err != nil || item == nil {
		return nil, nil, errors.New("item_not_object")
	}
	itemType, _ := rawJSONStringValue(item["type"])

	var cleanItem realtimeRawObject
	var itemNotes []string
	switch itemType {
	case "message":
		role, _ := rawJSONStringValue(item["role"])
		if role != "user" {
			return nil, nil, errors.New("message_role_not_allowed")
		}
		content, err := sanitizeRealtimeMessageContent(item["content"])
		if err != nil {
			return nil, nil, err
		}
		cleanItem, itemNotes = keepRealtimeFields(item, "id", "type", "role", "content")
		cleanItem["content"] = content
	case "function_call_output":
		callID, ok := rawJSONStringValue(item["call_id"])
		if !ok || callID == "" {
			return nil, nil, errors.New("call_id_missing")
		}
		output, ok := rawJSONStringValue(item["output"])
		if !ok || len(output) > realtimeMaxFunctionOutputBytes {
			return nil, nil, errors.New("function_output_invalid")
		}
		cleanItem, itemNotes = keepRealtimeFields(item, "id", "type", "call_id", "output")
	default:
		return nil, nil, errors.New("item_type_not_allowed")
	}

	encodedItem, err := json.Marshal(cleanItem)
	if err != nil {
		return nil, nil, errors.New("encode_failed")
	}
	sanitized["item"] = encodedItem
	return sanitized, append(notes, prefixRealtimeNotes("item.", itemNotes)...), nil
}

func sanitizeRealtimeMessageContent(raw json.RawMessage) (json.RawMessage, error) {
	var parts []realtimeRawObject
	if err := json.Unmarshal(raw, &parts); err != nil || len(parts) == 0 {
		return nil, errors.New("content_invalid")
	}
	clean := make([]realtimeRawObject, 0, len(parts))
	for _, part := range parts {
		partType, _ := rawJSONStringValue(part["type"])
		switch partType {
		case "input_text":
			text, ok := rawJSONStringValue(part["text"])
			if !ok || len([]rune(text)) > realtimeMaxInputTextRunes {
				return nil, errors.New("input_text_invalid")
			}
			kept, _ := keepRealtimeFields(part, "type", "text")
			clean = append(clean, kept)
		case "input_image":
			imageURL, ok := rawJSONStringValue(part["image_url"])
			if !ok || !strings.HasPrefix(imageURL, "data:image/") {
				return nil, errors.New("input_image_invalid")
			}
			kept, _ := keepRealtimeFields(part, "type", "image_url", "detail")
			clean = append(clean, kept)
		default:
			return nil, errors.New("content_type_not_allowed")
		}
	}
	return json.Marshal(clean)
}

func sanitizeRealtimeSessionUpdate(event realtimeRawObject) (realtimeRawObject, []string, error) {
	sanitized, notes := keepRealtimeFields(event, "type", "event_id", "session")
	var session realtimeRawObject
	if err := json.Unmarshal(event["session"], &session); err != nil || session == nil {
		return nil, nil, errors.New("session_not_object")
	}

	clean, sessionNotes := keepRealtimeFields(session, "type", "output_modalities", "instructions", "tools", "tool_choice", "audio")
	sessionNotes = prefixRealtimeNotes("session.", sessionNotes)

	if raw, ok := clean["type"]; ok {
		if value, _ := rawJSONStringValue(raw); value != "realtime" {
			delete(clean, "type")
			sessionNotes = append(sessionNotes, "session.type")
		}
	}

	if raw, ok := clean["output_modalities"]; ok {
		var modalities []string
		if err := json.Unmarshal(raw, &modalities); err != nil ||
			len(modalities) != 1 || (modalities[0] != "audio" && modalities[0] != "text") {
			delete(clean, "output_modalities")
			sessionNotes = append(sessionNotes, "session.output_modalities")
		}
	}

	if raw, ok := clean["instructions"]; ok {
		instructions, isString := rawJSONStringValue(raw)
		if !isString {
			delete(clean, "instructions")
			sessionNotes = append(sessionNotes, "session.instructions")
		} else if runes := []rune(instructions); len(runes) > realtimeMaxInstructionsRunes {
			clean["instructions"], _ = json.Marshal(string(runes[:realtimeMaxInstructionsRunes]))
			sessionNotes = append(sessionNotes, "session.instructions_truncated")
		}
	}

	if raw, ok := clean["tools"]; ok {
		tools, toolNotes := sanitizeRealtimeTools(raw)
		clean["tools"] = tools
		sessionNotes = append(sessionNotes, toolNotes...)
	}

	if raw, ok := clean["tool_choice"]; ok {
		if value, _ := rawJSONStringValue(raw); !realtimeAllowedToolChoices[value] {
			delete(clean, "tool_choice")
			sessionNotes = append(sessionNotes, "session.tool_choice")
		}
	}

	if raw, ok := clean["audio"]; ok {
		audio, audioNotes, err := sanitizeRealtimeSessionAudio(raw)
		if err != nil {
			delete(clean, "audio")
			sessionNotes = append(sessionNotes, "session.audio")
		} else {
			clean["audio"] = audio
			sessionNotes = append(sessionNotes, audioNotes...)
		}
	}

	encodedSession, err := json.Marshal(clean)
	if err != nil {
		return nil, nil, errors.New("encode_failed")
	}
	sanitized["session"] = encodedSession
	return sanitized, append(notes, sessionNotes...), nil
}

func sanitizeRealtimeTools(raw json.RawMessage) (json.RawMessage, []string) {
	var tools []json.RawMessage
	if err := json.Unmarshal(raw, &tools); err != nil {
		return json.RawMessage("[]"), []string{"session.tools"}
	}
	kept := make([]json.RawMessage, 0, len(tools))
	var notes []string
	for _, tool := range tools {
		var fields realtimeRawObject
		if err := json.Unmarshal(tool, &fields); err != nil {
			notes = append(notes, "session.tools.invalid")
			continue
		}
		toolType, _ := rawJSONStringValue(fields["type"])
		name, _ := rawJSONStringValue(fields["name"])
		if toolType != "function" || !realtimeAllowedToolNames[name] {
			notes = append(notes, fmt.Sprintf("session.tools.%q", truncateRealtimeNote(name)))
			continue
		}
		cleanTool, toolNotes := keepRealtimeFields(fields, "type", "name", "description", "parameters")
		encoded, err := json.Marshal(cleanTool)
		if err != nil || len(encoded) > realtimeMaxToolBytes {
			notes = append(notes, "session.tools."+name+"_too_large")
			continue
		}
		notes = append(notes, prefixRealtimeNotes("session.tools."+name+".", toolNotes)...)
		kept = append(kept, encoded)
	}
	encoded, _ := json.Marshal(kept)
	return encoded, notes
}

func sanitizeRealtimeSessionAudio(raw json.RawMessage) (json.RawMessage, []string, error) {
	var audio realtimeRawObject
	if err := json.Unmarshal(raw, &audio); err != nil || audio == nil {
		return nil, nil, errors.New("audio_not_object")
	}
	clean, notes := keepRealtimeFields(audio, "input", "output")
	notes = prefixRealtimeNotes("session.audio.", notes)

	if rawInput, ok := clean["input"]; ok {
		var input realtimeRawObject
		if err := json.Unmarshal(rawInput, &input); err != nil || input == nil {
			return nil, nil, errors.New("audio_input_not_object")
		}
		cleanInput, inputNotes := keepRealtimeFields(input, "transcription", "turn_detection", "noise_reduction", "format")
		notes = append(notes, prefixRealtimeNotes("session.audio.input.", inputNotes)...)
		if _, ok := cleanInput["transcription"]; ok {
			// The transcription model is billed to the server key; the server
			// configuration decides it, not the browser.
			var transcription realtimeRawObject
			_ = json.Unmarshal(cleanInput["transcription"], &transcription)
			serverModel := realtimeTranscriptionModel()
			if current, _ := rawJSONStringValue(transcription["model"]); current != serverModel {
				notes = append(notes, "session.audio.input.transcription.model")
			}
			cleanTranscription, transcriptionNotes := keepRealtimeFields(transcription, "language", "prompt")
			notes = append(notes, prefixRealtimeNotes("session.audio.input.transcription.", withoutRealtimeNote(transcriptionNotes, "model"))...)
			cleanTranscription["model"], _ = json.Marshal(serverModel)
			cleanInput["transcription"], _ = json.Marshal(cleanTranscription)
		}
		clean["input"], _ = json.Marshal(cleanInput)
	}

	if rawOutput, ok := clean["output"]; ok {
		var output realtimeRawObject
		if err := json.Unmarshal(rawOutput, &output); err != nil || output == nil {
			return nil, nil, errors.New("audio_output_not_object")
		}
		cleanOutput, outputNotes := keepRealtimeFields(output, "voice", "speed", "format")
		notes = append(notes, prefixRealtimeNotes("session.audio.output.", outputNotes)...)
		clean["output"], _ = json.Marshal(cleanOutput)
	}

	encoded, err := json.Marshal(clean)
	return encoded, notes, err
}

// keepRealtimeFields copies the allowed keys and reports the removed ones.
func keepRealtimeFields(source realtimeRawObject, allowed ...string) (realtimeRawObject, []string) {
	allowedSet := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = true
	}
	kept := make(realtimeRawObject, len(allowed))
	var removed []string
	for key, value := range source {
		if allowedSet[key] {
			kept[key] = value
			continue
		}
		removed = append(removed, truncateRealtimeNote(key))
	}
	sort.Strings(removed)
	return kept, removed
}

func rawJSONStringValue(raw json.RawMessage) (string, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func prefixRealtimeNotes(prefix string, notes []string) []string {
	prefixed := make([]string, 0, len(notes))
	for _, note := range notes {
		prefixed = append(prefixed, prefix+note)
	}
	return prefixed
}

func withoutRealtimeNote(notes []string, drop string) []string {
	kept := notes[:0]
	for _, note := range notes {
		if note != drop {
			kept = append(kept, note)
		}
	}
	return kept
}

// truncateRealtimeNote keeps client-controlled key names short and printable
// before they reach the logs.
func truncateRealtimeNote(value string) string {
	value = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == ',' {
			return '_'
		}
		return r
	}, value)
	if runes := []rune(value); len(runes) > 40 {
		return string(runes[:40])
	}
	return value
}
