package api

import (
    "github.com/gin-gonic/gin"
    "net/http"
)

// Future middleware: Rate limit, CORS, etc.
func RateLimitMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        // TODO: Implement rate limiting
        c.Next()
    }
}

func CORSMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
        c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if c.Request.Method == http.MethodOptions {
            c.AbortWithStatus(http.StatusNoContent)
            return
        }
        c.Next()
    }
}
