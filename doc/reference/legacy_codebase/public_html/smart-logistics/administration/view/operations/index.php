<?php
require_once __DIR__ . '/../../includes/init.php';
require_once __DIR__ . '/../../includes/role_guard.php';
require_role(['OPERATIONS']);
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Operations Dashboard | Smart LS</title>
    
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../../css/admin.css">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">

    <style>
        :root {
            --smart-blue: #1F99D8;
            --smart-dark: #055B83;
            --smart-orange: #EE7D04;
            --smart-charcoal: #231F20;
            --smart-bg: #F0F4F8;
            --sidebar-width: 260px;
        }

        body {
            font-family: 'Manrope', sans-serif;
            background-color: var(--smart-bg);
            color: var(--smart-charcoal);
            overflow-x: hidden;
        }

        h1, h2, h3, h4, h5, h6 { font-family: 'Montserrat', sans-serif; }

        /* --- SIDEBAR --- */
        .sidebar {
            width: var(--sidebar-width);
            height: 100vh;
            position: fixed;
            top: 0;
            left: 0;
            background-color: #ffffff;
            border-right: 1px solid #e0e0e0;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            box-shadow: 2px 0 10px rgba(0,0,0,0.02);
        }

        .sidebar-header {
            height: 70px;
            display: flex;
            align-items: center;
            padding: 0 20px;
            border-bottom: 1px solid #f0f0f0;
        }

        .brand-logo {
            font-weight: 800;
            font-size: 1.1rem;
            color: var(--smart-charcoal);
            text-decoration: none;
            letter-spacing: -0.5px;
        }

        .sidebar-menu { overflow-y: auto; flex-grow: 1; padding: 10px 0; }

        .menu-btn {
            width: 100%;
            text-align: left;
            background: none;
            border: none;
            padding: 12px 20px;
            font-size: 0.8rem;
            font-weight: 700;
            color: #555;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s;
            border-left: 3px solid transparent;
        }

        .menu-btn:hover, .menu-btn[aria-expanded="true"] {
            color: var(--smart-orange); /* Ops uses Orange accent */
            background-color: #fff8f0;
            border-left-color: var(--smart-orange);
        }

        .menu-btn i.category-icon { width: 20px; margin-right: 8px; color: #888; transition: color 0.2s; }
        .menu-btn:hover i.category-icon { color: var(--smart-orange); }
        .menu-chevron { font-size: 0.7rem; transition: transform 0.3s; }
        .menu-btn[aria-expanded="true"] .menu-chevron { transform: rotate(180deg); }

        .sub-link {
            display: block;
            padding: 8px 20px 8px 48px;
            font-size: 0.75rem;
            color: #666;
            text-decoration: none;
            font-weight: 500;
            transition: all 0.2s;
            line-height: 1.3;
        }
        .sub-link:hover { color: var(--smart-blue); background-color: #f0f9ff; }

        .sidebar-footer { border-top: 1px solid #f0f0f0; padding: 16px; }

        /* --- MAIN LAYOUT --- */
        .main-content {
            margin-left: var(--sidebar-width);
            padding-top: 70px;
            min-height: 100vh;
            width: calc(100% - var(--sidebar-width));
        }

        .top-navbar {
            height: 70px;
            position: fixed;
            top: 0;
            right: 0;
            left: var(--sidebar-width);
            background-color: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid #e0e0e0;
            z-index: 900;
            padding: 0 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        /* --- OPS WIDGETS --- */
        .ops-banner {
            background: linear-gradient(135deg, var(--smart-orange) 0%, #d35400 100%);
            color: white;
            border-radius: 12px;
            padding: 1.5rem 2rem;
            position: relative;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(238, 125, 4, 0.2);
            width: 100%;
        }

        .card-custom {
            background: white;
            border-radius: 12px;
            border: 1px solid rgba(0,0,0,0.05);
            box-shadow: 0 2px 12px rgba(0,0,0,0.02);
            height: 100%;
            transition: transform 0.2s;
        }
        .card-custom:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.05); }

        .kpi-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5px; white-space: nowrap; }
        .kpi-value { font-size: 1.6rem; font-weight: 800; color: var(--smart-charcoal); line-height: 1.2; font-variant-numeric: tabular-nums; }
        
        .table-custom th { font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 700; border-bottom: 2px solid #f0f0f0; }
        .table-custom td { font-size: 0.85rem; vertical-align: middle; padding: 12px 8px; }

        /* Clock */
        .clock-pill {
            background: #f1f5f9; padding: 6px 12px; border-radius: 30px;
            display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; color: var(--smart-dark);
        }
        .btn-clock {
            background: #e2e8f0; border: none; border-radius: 20px;
            padding: 4px 12px; font-size: 0.75rem; font-weight: 700; color: #64748b; transition: 0.3s;
        }
        .btn-clock.active { background: var(--smart-orange); color: white; box-shadow: 0 2px 10px rgba(238, 125, 4, 0.3); }

        /* Scrollable Activity */
        .log-container {
            max-height: 250px;
            overflow-y: auto;
            padding-right: 5px;
        }
        .log-container::-webkit-scrollbar { width: 4px; }
        .log-container::-webkit-scrollbar-track { background: #f1f1f1; }
        .log-container::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }

        /* Status Pills */
        .status-pill { padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
        .status-pending { background: #fef3c7; color: #b45309; }
        .status-active { background: #dbeafe; color: #1e40af; }
        .status-late { background: #fee2e2; color: #991b1b; }

    </style>
</head>
<body>

    <nav class="sidebar">
        <div class="sidebar-header">
            <a href="#" class="brand-logo"><i class="fa-solid fa-cube text-primary me-2"></i>SMART <span style="color: var(--smart-orange);">LS</span></a>
        </div>
        
        <div class="sidebar-menu accordion" id="opsMenu">
            
            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu1">
                    <span><i class="fa-solid fa-house category-icon"></i> Operations Home</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu1" class="accordion-collapse collapse show" data-bs-parent="#opsMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link fw-bold text-primary">Dashboards & KPI</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu2">
                    <span><i class="fa-solid fa-truck-fast category-icon"></i> Core Operations</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu2" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Ops File Registry</a>
                        <a href="#" class="sub-link">Transit Order Module</a>
                        <a href="#" class="sub-link">Delivery Note / POD</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu3">
                    <span><i class="fa-solid fa-timeline category-icon"></i> Milestones</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu3" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Milestone Tracking</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu4">
                    <span><i class="fa-solid fa-calculator category-icon"></i> Costing (Input)</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu4" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Costing Module</a>
                        <a href="#" class="sub-link">Extra Charges Sim.</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu5">
                    <span><i class="fa-solid fa-shield-halved category-icon"></i> Exposure</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu5" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Ops Cost Exposure</a>
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu6">
                    <span><i class="fa-solid fa-database category-icon"></i> Master Data</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu6" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Client Master</a>
                        
                    </div>
                </div>
            </div>

            <div class="accordion-item border-0">
                <button class="menu-btn" type="button" data-bs-toggle="collapse" data-bs-target="#menu7">
                    <span><i class="fa-solid fa-folder-open category-icon"></i> Documents</span>
                    <i class="fa-solid fa-chevron-down menu-chevron"></i>
                </button>
                <div id="menu7" class="accordion-collapse collapse" data-bs-parent="#opsMenu">
                    <div class="sub-menu">
                        <a href="#" class="sub-link">Document Vault</a>
                    </div>
                </div>
            </div>

        </div>

        <div class="sidebar-footer">
            <button class="btn btn-outline-danger w-100 btn-sm fw-bold"><i class="fa-solid fa-right-from-bracket me-2"></i> Sign Out</button>
        </div>
    </nav>

    <div class="top-navbar">
        <div>
            <h5 class="mb-0 fw-bold text-dark">Operations Center</h5>
            <small class="text-muted" style="font-size: 0.7rem;">EXECUTION & LOGISTICS MANAGEMENT</small>
        </div>
        
        <div class="d-flex align-items-center gap-4">
            <div class="clock-pill">
                <span id="realtime-clock" style="font-family: monospace;">12:00:00</span>
                <button class="btn-clock" id="btn-clock" onclick="toggleClock()">
                    <i class="fa-solid fa-fingerprint"></i> <span>Clock In</span>
                </button>
            </div>
            <div class="d-flex align-items-center gap-3 ps-3 border-start">
                <div class="text-end lh-1 d-none d-md-block">
                    <div class="fw-bold fs-6">Mike Ross</div>
                    <small class="text-dark fw-bold" style="font-size: 0.65rem; letter-spacing: 0.5px;">OPS COORDINATOR</small>
                </div>
                <img src="https://ui-avatars.com/api/?name=Mike+Ross&background=EE7D04&color=fff" class="rounded-circle shadow-sm" width="38" height="38" alt="MR">
            </div>
        </div>
    </div>

    <div class="main-content px-4 pb-5">
        
        <div class="row pt-4 mb-4">
            <div class="col-12">
                <div class="ops-banner d-flex justify-content-between align-items-center">
                    <div>
                        <h2 class="fw-bold mb-1">Good morning, Mike!</h2>
                        <p class="mb-0 opacity-75">You have 5 shipments arriving this week and 2 pending PODs.</p>
                    </div>
                    <div class="text-end" style="min-width: 150px;">
                        <div class="mb-1 text-uppercase text-white-50" style="font-size: 0.7rem; font-weight: 800;">Field Status</div>
                        <div class="d-flex align-items-center justify-content-end gap-2">
                            <i class="fa-solid fa-truck-fast text-white fs-5"></i>
                            <span class="fw-bold fs-5">ACTIVE</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row g-3 mb-4">
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-folder-open"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Active Files</div>
                        <div class="kpi-value">18</div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-stopwatch"></i>
                    </div>
                    <div>
                        <div class="kpi-title">On-Time Performance</div>
                        <div class="kpi-value text-success">94%</div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-danger bg-opacity-10 text-danger d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-bell"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Delayed Steps</div>
                        <div class="kpi-value text-danger">2</div>
                    </div>
                </div>
            </div>
            <div class="col-3">
                <div class="card-custom p-3 d-flex align-items-center">
                    <div class="me-3 rounded-3 bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center" style="width: 45px; height: 45px; font-size: 1.2rem;">
                        <i class="fa-solid fa-file-signature"></i>
                    </div>
                    <div>
                        <div class="kpi-title">Pending PODs</div>
                        <div class="kpi-value">4</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="fw-bold mb-0 text-dark"><i class="fa-solid fa-list-ul text-primary me-2"></i>Execution Queue (Action Required)</h5>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-outline-secondary active">All</button>
                            <button class="btn btn-sm btn-outline-secondary">Sea</button>
                            <button class="btn btn-sm btn-outline-secondary">Air</button>
                            <button class="btn btn-sm btn-outline-secondary">Road</button>
                        </div>
                    </div>
                    
                    <div class="table-responsive">
                        <table class="table table-hover table-custom mb-0">
                            <thead class="bg-light">
                                <tr>
                                    <th style="width: 15%;">File Ref</th>
                                    <th style="width: 25%;">Client / Route</th>
                                    <th style="width: 30%;">Current Stage</th>
                                    <th style="width: 15%;">Status</th>
                                    <th style="width: 15%;" class="text-end">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="font-monospace fw-bold text-primary">SL24010045</td>
                                    <td>
                                        <div class="fw-bold">TotalEnergies</div>
                                        <div class="text-muted" style="font-size: 0.7rem;">CN -> CM (Douala)</div>
                                    </td>
                                    <td>
                                        <span class="fw-bold text-dark">Customs Clearance</span>
                                        <br><span class="text-muted" style="font-size: 0.7rem;">Waiting for IM4</span>
                                    </td>
                                    <td><span class="status-pill status-active">In Progress</span></td>
                                    <td class="text-end">
                                        <button class="btn btn-sm btn-primary py-0 px-2" title="Update Milestone"><i class="fa-solid fa-pen-to-square"></i> Update</button>
                                    </td>
                                </tr>
                                <tr>
                                    <td class="font-monospace fw-bold text-primary">SL24010022</td>
                                    <td>
                                        <div class="fw-bold">Maersk Cameroon</div>
                                        <div class="text-muted" style="font-size: 0.7rem;">CM -> FR (Paris)</div>
                                    </td>
                                    <td>
                                        <span class="fw-bold text-dark">Proof of Delivery</span>
                                        <br><span class="text-muted" style="font-size: 0.7rem;">Cargo Delivered yesterday</span>
                                    </td>
                                    <td><span class="status-pill status-pending">Pending POD</span></td>
                                    <td class="text-end">
                                        <button class="btn btn-sm btn-warning text-dark py-0 px-2" title="Upload POD"><i class="fa-solid fa-upload"></i> Upload</button>
                                    </td>
                                </tr>
                                <tr>
                                    <td class="font-monospace fw-bold text-primary">SL24010050</td>
                                    <td>
                                        <div class="fw-bold">Local Cocoa Exp</div>
                                        <div class="text-muted" style="font-size: 0.7rem;">Kribi -> US</div>
                                    </td>
                                    <td>
                                        <span class="fw-bold text-dark">Vessel Departure</span>
                                        <br><span class="text-muted" style="font-size: 0.7rem;">ETD Today</span>
                                    </td>
                                    <td><span class="status-pill status-late">Late (1 Day)</span></td>
                                    <td class="text-end">
                                        <button class="btn btn-sm btn-outline-danger py-0 px-2" title="Report Delay"><i class="fa-solid fa-triangle-exclamation"></i> Report</button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-12">
                <div class="card-custom p-4">
                    <h5 class="fw-bold mb-4 text-dark"><i class="fa-solid fa-clock-rotate-left text-primary me-2"></i>Recent Operations Updates</h5>
                    
                    <div class="log-container">
                        
                        <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                            <div class="rounded-circle bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-check"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Milestone Completed</p>
                                    <small class="text-muted">10:00 AM</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Marked <strong>Cargo Discharge</strong> as complete for SL24010012.</p>
                            </div>
                        </div>

                        <div class="d-flex gap-3 mb-3 border-bottom pb-3">
                            <div class="rounded-circle bg-warning bg-opacity-10 text-warning d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-file-invoice-dollar"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Cash Request Submitted</p>
                                    <small class="text-muted">Yesterday</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Requested 150,000 XAF for Port Handling (File SL24010045). Waiting for Finance.</p>
                            </div>
                        </div>

                        <div class="d-flex gap-3">
                            <div class="rounded-circle bg-secondary bg-opacity-10 text-secondary d-flex align-items-center justify-content-center flex-shrink-0" style="width: 36px; height: 36px;">
                                <i class="fa-solid fa-cloud-arrow-up"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex justify-content-between">
                                    <p class="mb-0 fw-bold text-dark fs-6">Document Uploaded</p>
                                    <small class="text-muted">Oct 23</small>
                                </div>
                                <p class="text-muted mb-0" style="font-size: 0.85rem;">Uploaded <strong>Bill of Lading</strong> for SL24010050.</p>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>

    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="../../js/admin.js"></script>

  
</body>
</html>