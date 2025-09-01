export const Venue = () => {
    return (<section id="venue" className="venue-section">
        <div className="section-header">
            <h2 className="section-title">Venue Information</h2>
            <h3 className="section-title-cn">场地信息</h3>
        </div>
        <div className="venue-content">
            <div className="venue-info">
                <h3>Seattle Convention Center</h3>
                <p style={{color: '#ff8e53', marginBottom: '30px', fontFamily: 'Noto Sans SC'}}>
                    西雅图会议中心
                </p>
                <div className="venue-details">
                    <div className="venue-item">
                        <div className="venue-icon">📍</div>
                        <div className="venue-text">
                            <h4>Address 地址</h4>
                            <p>705 Pike Street, Seattle, WA 98101</p>
                        </div>
                    </div>
                    <div className="venue-item">
                        <div className="venue-icon">🚇</div>
                        <div className="venue-text">
                            <h4>Public Transit 公共交通</h4>
                            <p>Link Light Rail: Convention Place Station</p>
                        </div>
                    </div>
                    <div className="venue-item">
                        <div className="venue-icon">🚗</div>
                        <div className="venue-text">
                            <h4>Parking 停车</h4>
                            <p>Multiple parking garages nearby 附近多个停车场</p>
                        </div>
                    </div>
                    <div className="venue-item">
                        <div className="venue-icon">🏨</div>
                        <div className="venue-text">
                            <h4>Hotels 酒店</h4>
                            <p>Partner hotel discounts available 合作酒店折扣</p>
                        </div>
                    </div>
                </div>
            </div>
            <div className="venue-map">
                <div className="map-placeholder">
                    <div className="map-icon">🗺️</div>
                    <h3 style={{color: '#ff6b9d', marginBottom: '10px'}}>Interactive Map</h3>
                    <p style={{color: '#8a8a8a'}}>Click to view on Google Maps</p>
                </div>
            </div>
        </div>
    </section>)
}