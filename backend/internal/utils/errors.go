package utils

import (
	"fmt"
)

// ErrorType 定义错误类型
type ErrorType string

const (
	ErrorTypeValidation   ErrorType = "validation"
	ErrorTypeNotFound     ErrorType = "not_found"
	ErrorTypeInternal     ErrorType = "internal"
	ErrorTypeExternal     ErrorType = "external_service"
	ErrorTypeTimeout      ErrorType = "timeout"
	ErrorTypeRateLimit    ErrorType = "rate_limit"
	ErrorTypeUnauthorized ErrorType = "unauthorized"
)

// AppError 应用错误结构
type AppError struct {
	Type        ErrorType
	UserMsg     string // 给用户看的错误消息
	InternalMsg string // 内部日志用的详细错误消息
	Err         error  // 原始错误
}

func (e *AppError) Error() string {
	return e.UserMsg
}

func (e *AppError) Unwrap() error {
	return e.Err
}

// NewAppError 创建新的应用错误
func NewAppError(errType ErrorType, userMsg string, err error) *AppError {
	internalMsg := userMsg
	if err != nil {
		internalMsg = fmt.Sprintf("%s: %v", userMsg, err)
	}
	return &AppError{
		Type:        errType,
		UserMsg:     userMsg,
		InternalMsg: internalMsg,
		Err:         err,
	}
}

// SafeError 创建安全的用户友好错误消息
func SafeError(errType ErrorType, userMsg string, err error) error {
	// 记录详细错误到日志
	if err != nil {
		logger := SystemLogger()
		logger.Error("safe_error", userMsg, err, map[string]interface{}{
			"error_type": string(errType),
		})
	}

	return NewAppError(errType, userMsg, err)
}
