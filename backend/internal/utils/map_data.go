package utils

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/paulmach/orb/geojson"
)

const (
	// 世界地图数据URL - 使用Natural Earth 1:10m高精度国家数据（官方仓库）
	WorldMapURL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"
	// 小型岛屿数据URL - 使用Natural Earth 1:10m小型岛屿数据
	MinorIslandsURL = "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/10m/physical/ne_10m_minor_islands.json"
	// 本地存储路径
	MapDataDir          = "data/maps"
	WorldMapFile        = "world.geojson"
	WorldMapMD5File     = "world.geojson.md5"
	MinorIslandsFile    = "minor_islands.json"
	MinorIslandsMD5File = "minor_islands.json.md5"
	// 数据更新检查间隔（7天）
	UpdateCheckInterval = 7 * 24 * time.Hour
)

// MapDataManager 地图数据管理器
type MapDataManager struct {
	dataDir string
}

// NewMapDataManager 创建地图数据管理器
func NewMapDataManager() *MapDataManager {
	// 获取相对于backend根目录的路径
	dataDir := getBackendRootPath(MapDataDir)
	return &MapDataManager{
		dataDir: dataDir,
	}
}

// getBackendRootPath 获取相对于backend根目录的路径
func getBackendRootPath(relativePath string) string {
	// 尝试找到backend根目录
	currentDir, _ := os.Getwd()

	// 如果当前在backend目录或其子目录中
	for {
		// 检查是否存在go.mod文件（标识backend根目录）
		if _, err := os.Stat(filepath.Join(currentDir, "go.mod")); err == nil {
			return filepath.Join(currentDir, relativePath)
		}

		// 向上一级目录
		parentDir := filepath.Dir(currentDir)
		if parentDir == currentDir {
			// 已到达根目录，使用相对路径
			break
		}
		currentDir = parentDir
	}

	// 如果找不到backend根目录，使用相对路径
	return relativePath
}

// EnsureWorldMapData 确保世界地图数据存在，如果不存在或过期则下载
func (m *MapDataManager) EnsureWorldMapData() error {
	worldMapPath := filepath.Join(m.dataDir, WorldMapFile)
	md5Path := filepath.Join(m.dataDir, WorldMapMD5File)

	// 检查文件是否存在
	if !m.fileExists(worldMapPath) {
		fmt.Println("世界地图数据不存在，开始下载...")
		return m.downloadWorldMapData()
	}

	// 检查文件是否需要更新
	if m.shouldUpdate(worldMapPath) {
		fmt.Println("检查世界地图数据更新...")

		// 获取远程文件的MD5
		remoteMD5, err := m.getRemoteFileMD5()
		if err != nil {
			fmt.Printf("获取远程文件MD5失败，使用本地文件: %v\n", err)
			return nil
		}

		// 获取本地文件的MD5
		localMD5, err := m.getLocalFileMD5(md5Path)
		if err != nil {
			fmt.Printf("获取本地文件MD5失败，重新下载: %v\n", err)
			return m.downloadWorldMapData()
		}

		// 比较MD5，如果不同则更新
		if remoteMD5 != localMD5 {
			fmt.Println("发现新版本，开始更新世界地图数据...")
			return m.downloadWorldMapData()
		}

		fmt.Println("世界地图数据已是最新版本")
	}

	return nil
}

// LoadWorldMapData 加载本地世界地图数据
func (m *MapDataManager) LoadWorldMapData() (*geojson.FeatureCollection, error) {
	worldMapPath := filepath.Join(m.dataDir, WorldMapFile)

	if !m.fileExists(worldMapPath) {
		return nil, fmt.Errorf("世界地图数据文件不存在: %s", worldMapPath)
	}

	data, err := os.ReadFile(worldMapPath)
	if err != nil {
		return nil, fmt.Errorf("读取世界地图数据失败: %w", err)
	}

	var fc geojson.FeatureCollection
	err = json.Unmarshal(data, &fc)
	if err != nil {
		return nil, fmt.Errorf("解析世界地图数据失败: %w", err)
	}

	return &fc, nil
}

// downloadWorldMapData 下载世界地图数据
func (m *MapDataManager) downloadWorldMapData() error {
	// 确保目录存在
	if err := os.MkdirAll(m.dataDir, 0755); err != nil {
		return fmt.Errorf("创建数据目录失败: %w", err)
	}

	// 下载数据
	fmt.Printf("正在从 %s 下载世界地图数据...\n", WorldMapURL)
	resp, err := http.Get(WorldMapURL)
	if err != nil {
		return fmt.Errorf("下载世界地图数据失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP请求失败，状态码: %d", resp.StatusCode)
	}

	// 读取数据
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("读取响应数据失败: %w", err)
	}

	// 验证JSON格式
	var fc geojson.FeatureCollection
	if err := json.Unmarshal(data, &fc); err != nil {
		return fmt.Errorf("下载的数据格式无效: %w", err)
	}

	// 保存到本地文件
	worldMapPath := filepath.Join(m.dataDir, WorldMapFile)
	if err := os.WriteFile(worldMapPath, data, 0644); err != nil {
		return fmt.Errorf("保存世界地图数据失败: %w", err)
	}

	// 计算并保存MD5
	md5Hash := fmt.Sprintf("%x", md5.Sum(data))
	md5Path := filepath.Join(m.dataDir, WorldMapMD5File)
	if err := os.WriteFile(md5Path, []byte(md5Hash), 0644); err != nil {
		return fmt.Errorf("保存MD5文件失败: %w", err)
	}

	fmt.Printf("世界地图数据下载完成，保存到: %s\n", worldMapPath)
	fmt.Printf("数据大小: %.2f KB\n", float64(len(data))/1024)
	fmt.Printf("特征数量: %d\n", len(fc.Features))

	return nil
}

// fileExists 检查文件是否存在
func (m *MapDataManager) fileExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

// shouldUpdate 检查是否应该更新文件
func (m *MapDataManager) shouldUpdate(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return true
	}

	// 如果文件超过更新检查间隔，则检查更新
	return time.Since(info.ModTime()) > UpdateCheckInterval
}

// getRemoteFileMD5 获取远程文件的MD5（通过下载并计算）
func (m *MapDataManager) getRemoteFileMD5() (string, error) {
	resp, err := http.Get(WorldMapURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP请求失败，状态码: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", md5.Sum(data)), nil
}

// getLocalFileMD5 获取本地MD5文件的内容
func (m *MapDataManager) getLocalFileMD5(md5Path string) (string, error) {
	if !m.fileExists(md5Path) {
		return "", fmt.Errorf("MD5文件不存在")
	}

	data, err := os.ReadFile(md5Path)
	if err != nil {
		return "", err
	}

	return string(data), nil
}

// GetMapDataInfo 获取地图数据信息
func (m *MapDataManager) GetMapDataInfo() (map[string]interface{}, error) {
	worldMapPath := filepath.Join(m.dataDir, WorldMapFile)

	info := make(map[string]interface{})

	if !m.fileExists(worldMapPath) {
		info["exists"] = false
		return info, nil
	}

	stat, err := os.Stat(worldMapPath)
	if err != nil {
		return nil, err
	}

	info["exists"] = true
	info["path"] = worldMapPath
	info["size"] = stat.Size()
	info["modified"] = stat.ModTime()
	info["size_kb"] = float64(stat.Size()) / 1024

	// 尝试加载并获取特征数量
	fc, err := m.LoadWorldMapData()
	if err == nil {
		info["features_count"] = len(fc.Features)
	}

	return info, nil
}

// EnsureMinorIslandsData 确保小型岛屿数据存在，如果不存在或过期则下载
func (m *MapDataManager) EnsureMinorIslandsData() error {
	minorIslandsPath := filepath.Join(m.dataDir, MinorIslandsFile)
	md5Path := filepath.Join(m.dataDir, MinorIslandsMD5File)

	// 检查文件是否存在
	if !m.fileExists(minorIslandsPath) {
		fmt.Println("小型岛屿数据不存在，开始下载...")
		return m.downloadMinorIslandsData()
	}

	// 检查文件是否需要更新
	if m.shouldUpdate(minorIslandsPath) {
		fmt.Println("检查小型岛屿数据更新...")

		// 获取远程文件的MD5
		remoteMD5, err := m.getRemoteMinorIslandsMD5()
		if err != nil {
			fmt.Printf("获取远程小型岛屿MD5失败，使用本地文件: %v\n", err)
			return nil
		}

		// 获取本地文件的MD5
		localMD5, err := m.getLocalFileMD5(md5Path)
		if err != nil {
			fmt.Printf("获取本地小型岛屿MD5失败，重新下载: %v\n", err)
			return m.downloadMinorIslandsData()
		}

		// 比较MD5，如果不同则更新
		if remoteMD5 != localMD5 {
			fmt.Println("发现新版本，开始更新小型岛屿数据...")
			return m.downloadMinorIslandsData()
		}

		fmt.Println("小型岛屿数据已是最新版本")
	}

	return nil
}

// LoadMinorIslandsData 加载本地小型岛屿数据
func (m *MapDataManager) LoadMinorIslandsData() (*geojson.FeatureCollection, error) {
	minorIslandsPath := filepath.Join(m.dataDir, MinorIslandsFile)

	if !m.fileExists(minorIslandsPath) {
		return nil, fmt.Errorf("小型岛屿数据文件不存在: %s", minorIslandsPath)
	}

	data, err := os.ReadFile(minorIslandsPath)
	if err != nil {
		return nil, fmt.Errorf("读取小型岛屿数据失败: %w", err)
	}

	var fc geojson.FeatureCollection
	err = json.Unmarshal(data, &fc)
	if err != nil {
		return nil, fmt.Errorf("解析小型岛屿数据失败: %w", err)
	}

	return &fc, nil
}

// downloadMinorIslandsData 下载小型岛屿数据
func (m *MapDataManager) downloadMinorIslandsData() error {
	// 确保目录存在
	if err := os.MkdirAll(m.dataDir, 0755); err != nil {
		return fmt.Errorf("创建数据目录失败: %w", err)
	}

	// 下载数据
	fmt.Printf("正在从 %s 下载小型岛屿数据...\n", MinorIslandsURL)
	resp, err := http.Get(MinorIslandsURL)
	if err != nil {
		return fmt.Errorf("下载小型岛屿数据失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP请求失败，状态码: %d", resp.StatusCode)
	}

	// 读取数据
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("读取响应数据失败: %w", err)
	}

	// 验证JSON格式
	var fc geojson.FeatureCollection
	if err := json.Unmarshal(data, &fc); err != nil {
		return fmt.Errorf("下载的小型岛屿数据格式无效: %w", err)
	}

	// 保存到本地文件
	minorIslandsPath := filepath.Join(m.dataDir, MinorIslandsFile)
	if err := os.WriteFile(minorIslandsPath, data, 0644); err != nil {
		return fmt.Errorf("保存小型岛屿数据失败: %w", err)
	}

	// 计算并保存MD5
	md5Hash := fmt.Sprintf("%x", md5.Sum(data))
	md5Path := filepath.Join(m.dataDir, MinorIslandsMD5File)
	if err := os.WriteFile(md5Path, []byte(md5Hash), 0644); err != nil {
		return fmt.Errorf("保存小型岛屿MD5文件失败: %w", err)
	}

	fmt.Printf("小型岛屿数据下载完成，保存到: %s\n", minorIslandsPath)
	fmt.Printf("数据大小: %.2f KB\n", float64(len(data))/1024)
	fmt.Printf("特征数量: %d\n", len(fc.Features))

	return nil
}

// getRemoteMinorIslandsMD5 获取远程小型岛屿数据的MD5（通过下载并计算）
func (m *MapDataManager) getRemoteMinorIslandsMD5() (string, error) {
	resp, err := http.Get(MinorIslandsURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP请求失败，状态码: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", md5.Sum(data)), nil
}
