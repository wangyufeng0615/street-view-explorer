export const formatAddress = (location) => {
    if (!location) return '';
    
    if (location.formatted_address) {
        return location.formatted_address;
    }

    // 如果没有 formatted_address，尝试组合其他地址信息
    const parts = [];
    if (location.city) parts.push(location.city);
    if (location.country) parts.push(location.country);
    
    // 如果连城市和国家都没有，显示坐标
    if (parts.length === 0) {
        return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
    }

    return parts.join(', ');
}; 