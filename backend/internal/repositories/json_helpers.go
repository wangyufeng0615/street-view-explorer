package repositories

import "encoding/json"

func marshalJSON(v interface{}) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func unmarshalJSON(data string, v interface{}) error {
	return json.Unmarshal([]byte(data), v)
}
