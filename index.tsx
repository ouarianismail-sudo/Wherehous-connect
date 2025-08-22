/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
declare var Chart: any; // Make Chart.js available globally

// --- DATA TYPES ---
interface Client {
    id: number;
    name: string; // Nom complet ou Raison Sociale
    joinDate: string;
    type: 'particulier' | 'personne morale';
    phone: string;
    address: string;
    email: string;
    comment?: string; // Optional
}

interface StockMovement {
    id: number;
    clientId: number;
    type: 'in' | 'out';
    product: string;
    totalWeight: number;      // Poids brut (produit + box), entrée principale
    plasticBoxCount?: number;
    plasticBoxWeight?: number; // Poids unitaire
    woodBoxCount?: number;
    woodBoxWeight?: number;    // Poids unitaire
    productWeight: number;    // Poids net, calculé: totalWeight - poids total des box
    date: string; // YYYY-MM-DD
    recordedByUserId: number; // ID of the user who recorded the movement
    comment?: string; // Receptionist comment
    farmerComment?: string; // Farmer's anomaly report
    isCommentRead?: boolean; // Tracking if the farmer's comment has been read
}


interface User {
    id: number;
    username: string;
    name: string;
    role: 'Admin' | 'Réceptionniste' | 'Agriculteur';
    status: 'Active' | 'Suspended';
    clientId?: number; // Link to a client if the user is an 'Agriculteur'
    password?: string; // Only used for frontend forms, never stored long-term
}


// --- DATA STORE (Simulating a database) ---
// Data is now fetched from the server. These arrays act as a local cache.
let clients: Client[] = [];
let users: User[] = [];
let stockMovements: StockMovement[] = [];


// --- APP STATE ---
type Page = 'dashboard' | 'clients' | 'movements' | 'users' | 'farmer_stock' | 'receptionist_dashboard';
let currentPage: Page = 'dashboard';
let currentUser: User | null = null;
let isAppLoading = true; // For initial data load

// Dashboard state
type DashboardDateFilter = '7d' | '30d' | '90d' | 'all';
let dashboardDateFilter: DashboardDateFilter = '30d';
let movementTrendChart: any = null;
let topProductsChart: any = null;

interface MovementFilters {
    startDate: string;
    endDate: string;
    clientId: string[];
    product: string[];
    recordedByUserId: string[];
}

const getInitialMovementFilters = (): MovementFilters => ({
    startDate: '',
    endDate: '',
    clientId: [],
    product: [],
    recordedByUserId: [],
});

let movementFilters: MovementFilters = getInitialMovementFilters();


// --- UTILITY FUNCTIONS ---
function showToast(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = createElement('div', {
        className: `toast toast-${type}`,
        role: 'alert',
        'aria-live': 'assertive'
    });
    toast.textContent = message;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Animate out and remove after a delay
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000);
}

function formatDate(dateString: string): string {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function formatNumber(num: number, decimals = 2): string {
    return num.toFixed(decimals);
}

function showConfirmationModal(title: string, message: string, onConfirm: () => void) {
    const content = createElement('div', { className: 'modal-content' });

    const header = createElement('div', { className: 'modal-header' });
    const titleEl = createElement('h2', { textContent: title });
    const closeBtn = createElement('button', { className: 'modal-close-btn', textContent: '×' });
    closeBtn.addEventListener('click', closeModal);
    header.append(titleEl, closeBtn);

    const body = createElement('div', { className: 'modal-body' });
    const messageEl = createElement('p', { textContent: message });
    body.appendChild(messageEl);

    const footer = createElement('div', { className: 'modal-footer' });
    const cancelBtn = createElement('button', { className: 'btn btn-secondary', textContent: 'Annuler' });
    cancelBtn.addEventListener('click', closeModal);
    const confirmBtn = createElement('button', { className: 'btn btn-danger', textContent: 'Confirmer' });
    confirmBtn.addEventListener('click', () => {
        onConfirm();
        closeModal();
    });
    footer.append(cancelBtn, confirmBtn);

    content.append(header, body, footer);
    openModal(content, 'small');
}


interface StockSummary {
    totalWeight: number;
    productWeight: number;
    plasticBoxes: number;
    woodBoxes: number;
}

function getClientStockSummary(clientId: number): StockSummary {
    const summary: StockSummary = { totalWeight: 0, productWeight: 0, plasticBoxes: 0, woodBoxes: 0 };
    stockMovements.forEach(movement => {
        if (movement.clientId === clientId) {
            const multiplier = movement.type === 'in' ? 1 : -1;
            summary.totalWeight += movement.totalWeight * multiplier;
            summary.productWeight += movement.productWeight * multiplier;
            if (movement.plasticBoxCount) {
                summary.plasticBoxes += movement.plasticBoxCount * multiplier;
            }
            if (movement.woodBoxCount) {
                summary.woodBoxes += movement.woodBoxCount * multiplier;
            }
        }
    });
    return summary;
}

function getProductStockForClient(clientId: number, product: string): number {
    return stockMovements
        .filter(m => m.clientId === clientId && m.product === product)
        .reduce((stock, movement) => {
            const multiplier = movement.type === 'in' ? 1 : -1;
            return stock + (movement.productWeight * multiplier);
        }, 0);
}

function getClientStockDetailsByProduct(clientId: number): { product: string; productWeight: number; totalWeight: number; plasticBoxes: number; woodBoxes: number; }[] {
    const productStock = new Map<string, { productWeight: number; totalWeight: number; plasticBoxes: number; woodBoxes: number }>();

    stockMovements
        .filter(m => m.clientId === clientId)
        .forEach(m => {
            const currentStock = productStock.get(m.product) || { productWeight: 0, totalWeight: 0, plasticBoxes: 0, woodBoxes: 0 };
            const multiplier = m.type === 'in' ? 1 : -1;
            
            currentStock.productWeight += m.productWeight * multiplier;
            currentStock.totalWeight += m.totalWeight * multiplier;
            currentStock.plasticBoxes += (m.plasticBoxCount || 0) * multiplier;
            currentStock.woodBoxes += (m.woodBoxCount || 0) * multiplier;
            
            productStock.set(m.product, currentStock);
        });

    return Array.from(productStock.entries())
        .map(([product, stock]) => ({
            product,
            productWeight: stock.productWeight,
            totalWeight: stock.totalWeight,
            plasticBoxes: stock.plasticBoxes,
            woodBoxes: stock.woodBoxes,
        }))
        .filter(item => item.productWeight > 0.005) // Avoid showing products with near-zero or negative stock
        .sort((a, b) => a.product.localeCompare(b.product));
}


function toggleClientStockDetails(clientRow: HTMLTableRowElement, clientId: number, colspan: number) {
    const icon = clientRow.querySelector('.expand-icon');
    const existingDetailsRow = clientRow.nextElementSibling as HTMLTableRowElement | null;

    if (existingDetailsRow && existingDetailsRow.classList.contains('details-row')) {
        // Collapse
        existingDetailsRow.remove();
        clientRow.classList.remove('expanded');
        if (icon) icon.textContent = '+';
    } else {
        // Expand
        const productStock = getClientStockDetailsByProduct(clientId);
        if (productStock.length > 0) {
            const detailsRow = createElement('tr', { className: 'details-row' });
            const detailsCell = createElement('td', { colSpan: colspan });
            
            const detailsContainer = createElement('div', { className: 'details-container' });
            const subTable = createTable(
                ['Produit', 'Stock Net (kg)', 'Stock Total (kg)', 'Box Plastique', 'Box Bois'],
                productStock.map(p => [
                    p.product,
                    formatNumber(p.productWeight),
                    formatNumber(p.totalWeight),
                    p.plasticBoxes.toString(),
                    p.woodBoxes.toString(),
                ])
            );
            subTable.classList.add('sub-table');

            detailsContainer.appendChild(subTable);
            detailsCell.appendChild(detailsContainer);
            detailsRow.appendChild(detailsCell);

            clientRow.after(detailsRow);
            clientRow.classList.add('expanded');
            if (icon) icon.textContent = '−';
        }
    }
}


function getClientNameById(clientId: number): string {
    return clients.find(c => c.id === clientId)?.name ?? 'Client inconnu';
}

function getClientById(clientId: number): Client | undefined {
    return clients.find(c => c.id === clientId);
}

function getUserNameById(userId: number): string {
    return users.find(u => u.id === userId)?.name ?? 'Utilisateur inconnu';
}

function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: { className?: string; textContent?: string; [key: string]: any }
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (options) {
        Object.entries(options).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'textContent') {
                element.textContent = value;
            } else if (key in element) {
                try { (element as any)[key] = value; } catch (e) { /* NOP */ }
            } else {
                element.setAttribute(key, value);
            }
        });
    }
    return element;
}

// --- AUTHENTICATION ---
async function handleLogin(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const usernameInput = document.getElementById('username') as HTMLInputElement;
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const roleSelect = document.getElementById('role') as HTMLSelectElement;
    const rememberMeCheckbox = document.getElementById('remember-me') as HTMLInputElement;
    const errorDiv = document.getElementById('login-error');

    if (!errorDiv || !submitBtn) return;
    errorDiv.style.display = 'none';

    const loginData = {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
        role: roleSelect.value,
    };

    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Connexion...`;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData),
        });

        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(responseData.message || 'Erreur de connexion');
        }

        const loggedInUser: User = responseData;

        if (rememberMeCheckbox.checked) {
            localStorage.setItem('warehouseRememberMe', JSON.stringify({ username: loggedInUser.username, role: loggedInUser.role }));
        } else {
            localStorage.removeItem('warehouseRememberMe');
        }

        currentUser = loggedInUser;
        if (currentUser.role === 'Agriculteur') {
            currentPage = 'farmer_stock';
        } else if (currentUser.role === 'Réceptionniste') {
            currentPage = 'receptionist_dashboard';
        } else {
            currentPage = 'dashboard';
        }
        renderApp();

    } catch (error: any) {
        errorDiv.textContent = error.message || 'Identifiants, mot de passe ou rôle incorrects.';
        errorDiv.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}


function handleLogout() {
    // We don't clear remember me on purpose, so the fields are pre-filled next time.
    // To truly forget, the user can uncheck the box and log in.
    currentUser = null;
    currentPage = 'dashboard';
    renderApp();
}

// --- MODAL HANDLING ---
function openModal(content: HTMLElement, size: 'normal' | 'small' = 'normal') {
    closeModal(); // Ensure no other modals are open
    const modalOverlay = createElement('div', { className: 'modal-overlay' });
    const modalContainer = createElement('div', { className: 'modal-container' });
    if(size === 'small') modalContainer.style.maxWidth = '450px';
    
    modalContainer.appendChild(content);
    modalOverlay.appendChild(modalContainer);

    // Close modal on overlay click
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeModal();
        }
    });
    
    // Close with Escape key
    const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);

    document.body.appendChild(modalOverlay);
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closeModal() {
    const modalOverlay = document.querySelector('.modal-overlay');
    if (modalOverlay) {
        modalOverlay.remove();
    }
    document.body.style.overflow = '';
}


// --- UI RENDERING FUNCTIONS ---
function renderLoginPage(): HTMLElement {
    const container = createElement('div', { className: 'login-container' });
    const form = createElement('form', { className: 'login-form' });
    form.addEventListener('submit', handleLogin);

    const title = createElement('h1', { textContent: 'WareHouse Connect' });
    const subtitle = createElement('p', { className: 'login-subtitle', textContent: 'Connectez-vous à votre espace' });

    const usernameLabel = createElement('label', { htmlFor: 'username', textContent: 'Nom d\'utilisateur' });
    const usernameInput = createElement('input', { type: 'text', id: 'username', placeholder: 'ex: admin', required: true });

    const passwordLabel = createElement('label', { htmlFor: 'password', textContent: 'Mot de passe' });
    const passwordInput = createElement('input', { type: 'password', id: 'password', placeholder: '••••••••••', required: true });
    
    const roleLabel = createElement('label', { htmlFor: 'role', textContent: 'Rôle' });
    const roleSelect = createElement('select', { id: 'role' });
    ['Admin', 'Réceptionniste', 'Agriculteur'].forEach(role => {
        const option = createElement('option', { value: role, textContent: role });
        roleSelect.appendChild(option);
    });
    
    const errorDiv = createElement('div', {id: 'login-error', className: 'login-error'});
    
    const rememberGroup = createElement('div', { className: 'remember-me-group' });
    const rememberCheckbox = createElement('input', { type: 'checkbox', id: 'remember-me' });
    const rememberLabel = createElement('label', { htmlFor: 'remember-me', textContent: 'Se souvenir de moi' });
    rememberGroup.append(rememberCheckbox, rememberLabel);

    const submitButton = createElement('button', { type: 'submit', className: 'btn btn-primary btn-full', textContent: 'Connexion' });

    const rememberedUserJSON = localStorage.getItem('warehouseRememberMe');
    if (rememberedUserJSON) {
        try {
            const { username, role } = JSON.parse(rememberedUserJSON);
            usernameInput.value = username;
            roleSelect.value = role;
            rememberCheckbox.checked = true;
        } catch(e) {
            console.error("Failed to parse remembered user data", e);
            localStorage.removeItem('warehouseRememberMe');
        }
    }

    form.append(title, subtitle, usernameLabel, usernameInput, passwordLabel, passwordInput, roleLabel, roleSelect, errorDiv, rememberGroup, submitButton);
    container.appendChild(form);
    return container;
}


function renderSidebar(): HTMLElement {
    const sidebar = createElement('aside', { className: 'sidebar' });
    const header = createElement('h2', { className: 'sidebar-header', textContent: 'WareHouse' });
    const nav = createElement('nav', { className: 'sidebar-nav' });
    const ul = createElement('ul');
    
    let navItems: { id: Page; text: string }[] = [];

    if (currentUser?.role === 'Admin') {
        navItems = [
            { id: 'dashboard', text: 'Tableau de bord' },
            { id: 'clients', text: 'Clients' },
            { id: 'movements', text: 'Mouvements' },
            { id: 'users', text: 'Utilisateurs' }
        ];
    } else if (currentUser?.role === 'Réceptionniste') {
        navItems = [
            { id: 'receptionist_dashboard', text: 'Tableau de bord' },
            { id: 'clients', text: 'Gestion Clients' },
            { id: 'movements', text: 'Gestion Mouvements' }
        ];
    } else if (currentUser?.role === 'Agriculteur') {
        navItems = [{ id: 'farmer_stock', text: 'Mon Stock' }];
    }

    navItems.forEach(item => {
        const li = createElement('li');
        const linkWrapper = createElement('div', { style: 'position: relative; display: flex;' });
        const a = createElement('a', { textContent: item.text, 'data-page': item.id, href: '#', style: 'flex-grow: 1;' });
        if (item.id === currentPage) a.className = 'active';

        if((item.id === 'movements' || item.id === 'receptionist_dashboard') && currentUser?.role === 'Réceptionniste') {
             const unreadCount = stockMovements.filter(m => m.recordedByUserId === currentUser.id && m.farmerComment && !m.isCommentRead).length;
            if(unreadCount > 0) {
                const badge = createElement('span', { className: 'notification-badge', textContent: unreadCount.toString() });
                a.appendChild(badge);
            }
        }
        
        linkWrapper.appendChild(a);
        li.appendChild(linkWrapper);
        ul.appendChild(li);
    });

    nav.appendChild(ul);
    sidebar.append(header, nav);

    nav.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const pageLink = target.closest('a');
        if (pageLink && pageLink.dataset.page) {
            e.preventDefault();
            const page = pageLink.dataset.page as Page;
            if (page !== currentPage) {
                currentPage = page;
                renderApp();
            }
        }
    });

    return sidebar;
}

function renderHeader(): HTMLElement {
    const headerEl = createElement('header', { className: 'header' });
    const titles: Record<Page, string> = {
        dashboard: 'Tableau de bord',
        clients: 'Gestion des Clients',
        movements: 'Historique des Mouvements',
        users: 'Gestion des Utilisateurs',
        farmer_stock: `Stock de ${currentUser?.name}`,
        receptionist_dashboard: 'Tableau de Bord Réceptionniste'
    };
    const title = createElement('h1', { textContent: titles[currentPage] });

    const userDisplay = createElement('div', { className: 'user-display' });
    if(currentUser) {
        const userName = createElement('span', { textContent: `Bienvenue, ${currentUser.name}` });
        const logoutButton = createElement('button', { className: 'btn btn-secondary', textContent: 'Déconnexion' });
        logoutButton.addEventListener('click', handleLogout);
        userDisplay.append(userName, logoutButton);
    }

    headerEl.append(title, userDisplay);
    return headerEl;
}

function renderMainContent(): HTMLElement {
    switch (currentPage) {
        case 'dashboard':
            return renderDashboard();
        case 'receptionist_dashboard':
            return renderReceptionistDashboard();
        case 'clients':
            return renderClientsPage();
        case 'movements':
            return renderMovementsPage();
        case 'users':
            return renderUsersPage();
        case 'farmer_stock':
            return renderFarmerStockPage();
        default:
            return createElement('div', { textContent: 'Page non trouvée' });
    }
}

function handleExportClientStockCSV() {
    const data = clients.map(client => {
        const stock = getClientStockSummary(client.id);
        return {
            name: client.name,
            joinDate: client.joinDate,
            totalWeight: stock.totalWeight,
            productWeight: stock.productWeight,
            plasticBoxes: stock.plasticBoxes,
            woodBoxes: stock.woodBoxes
        }
    });
    if (data.length === 0) {
        showToast("Aucune donnée à exporter.", 'info');
        return;
    }

    const headers = ["Client", "Date d'inscription", "Stock Total (kg)", "Stock Net Produit (kg)", "Box Plastique", "Box Bois"];
    const csvRows = [headers.join(',')];

    data.forEach(d => {
        const row = [
            `"${d.name}"`, 
            formatDate(d.joinDate), 
            formatNumber(d.totalWeight), 
            formatNumber(d.productWeight),
            d.plasticBoxes.toString(),
            d.woodBoxes.toString()
        ];
        csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `export_stock_clients_${today}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function handleExportClientListCSV() {
    if (clients.length === 0) {
        showToast("Aucun client à exporter.", 'info');
        return;
    }

    const headers = ["ID", "Nom / Raison Sociale", "Date d'inscription", "Type", "Téléphone", "Adresse", "Email", "Commentaire"];
    const csvRows = [headers.join(',')];

    clients.forEach(c => {
        const row = [
            c.id,
            `"${c.name.replace(/"/g, '""')}"`,
            formatDate(c.joinDate),
            c.type,
            `"${c.phone}"`,
            `"${c.address.replace(/"/g, '""')}"`,
            `"${c.email}"`,
            `"${(c.comment || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `export_liste_clients_${today}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renderDashboard(): HTMLElement {
    const main = createElement('main', { className: 'main-content' });

    // Destroy previous charts to prevent memory leaks
    if (movementTrendChart) movementTrendChart.destroy();
    if (topProductsChart) topProductsChart.destroy();

    // --- FILTERS ---
    const dateFilters = [
        { id: '7d', text: '7 Jours' },
        { id: '30d', text: '30 Jours' },
        { id: '90d', text: '90 Jours' },
        { id: 'all', text: 'Tout' }
    ];
    const filterContainer = createElement('div', { className: 'dashboard-filters' });
    dateFilters.forEach(filter => {
        const button = createElement('button', { 
            textContent: filter.text,
            className: dashboardDateFilter === filter.id ? 'active' : ''
        });
        button.onclick = () => {
            dashboardDateFilter = filter.id as DashboardDateFilter;
            renderApp();
        };
        filterContainer.appendChild(button);
    });

    // --- DATA CALCULATION ---
    const now = new Date();
    const getStartDate = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    let filteredMovements = stockMovements;
    if (dashboardDateFilter !== 'all') {
        const days = { '7d': 7, '30d': 30, '90d': 90 }[dashboardDateFilter];
        const startDate = getStartDate(days);
        filteredMovements = stockMovements.filter(m => m.date >= startDate);
    }
    
    const totalClients = clients.length;
    const stockIn = filteredMovements
        .filter(m => m.type === 'in')
        .reduce((sum, m) => sum + m.productWeight, 0);
    const stockOut = filteredMovements
        .filter(m => m.type === 'out')
        .reduce((sum, m) => sum + m.productWeight, 0);

    let totalStock = 0;
    let totalPlasticBoxes = 0;
    let totalWoodBoxes = 0;
    clients.forEach(client => {
        const summary = getClientStockSummary(client.id);
        totalStock += summary.productWeight;
        totalPlasticBoxes += summary.plasticBoxes;
        totalWoodBoxes += summary.woodBoxes;
    });

    // --- STATS GRID ---
    const statsGrid = createElement('div', { className: 'stats-grid' });
    const filterText = dateFilters.find(f => f.id === dashboardDateFilter)?.text.toLowerCase() || 'période';
    const stats = [
        { id: 'clients', title: 'Clients Actifs', value: totalClients.toString() },
        { id: 'stock', title: 'Stock Net Total (Actuel)', value: `${formatNumber(totalStock)} kg` },
        { id: 'in', title: `Entrées Net (${filterText})`, value: `+${formatNumber(stockIn)} kg`, class: 'in' },
        { id: 'out', title: `Sorties Net (${filterText})`, value: `-${formatNumber(stockOut)} kg`, class: 'out' },
    ];

    stats.forEach(stat => {
        const card = createElement('div', { className: 'stat-card' });
        const titleEl = createElement('h3', { className: 'stat-card-title', textContent: stat.title });
        const valueEl = createElement('p', { className: 'stat-card-value', textContent: stat.value });
        if (stat.class) valueEl.classList.add(stat.class);
        card.append(titleEl, valueEl);

        if (stat.id === 'stock') {
            const subtitle = createElement('p', { 
                className: 'stat-card-subtitle', 
                textContent: `Plastique: ${totalPlasticBoxes} | Bois: ${totalWoodBoxes}`
            });
            card.appendChild(subtitle);
        }
        statsGrid.appendChild(card);
    });

    // --- CHARTS ---
    const chartsGrid = createElement('div', { className: 'charts-grid' });
    
    // Movement Trend Chart
    const trendChartContainer = createElement('div', { className: 'chart-container' });
    const trendChartTitle = createElement('h3', { textContent: `Évolution des Mouvements (${filterText})` });
    const trendCanvas = createElement('canvas', { id: 'movementTrendChart' });
    trendChartContainer.append(trendChartTitle, trendCanvas);
    
    // Top Products Chart
    const topProductsContainer = createElement('div', { className: 'chart-container' });
    const topProductsTitle = createElement('h3', { textContent: 'Top 5 Produits en Stock (Actuel)' });
    const topProductsCanvas = createElement('canvas', { id: 'topProductsChart' });
    topProductsContainer.append(topProductsTitle, topProductsCanvas);

    chartsGrid.append(trendChartContainer, topProductsContainer);

    // --- CLIENT STOCK PANEL ---
    const clientStockPanel = createPanelWithTitle('Synthèse des Stocks par Client (Actuel)');
    const panelHeader = clientStockPanel.querySelector('.panel-header') as HTMLElement;
    const headerActions = createElement('div', { className: 'panel-header-actions' });

    const exportStockCsvButton = createElement('button', { className: 'btn btn-secondary', textContent: 'Exporter Stock CSV' });
    exportStockCsvButton.addEventListener('click', handleExportClientStockCSV);
    const exportClientsCsvButton = createElement('button', { className: 'btn btn-secondary', textContent: 'Exporter Clients CSV' });
    exportClientsCsvButton.addEventListener('click', handleExportClientListCSV);

    headerActions.append(exportStockCsvButton, exportClientsCsvButton);
    panelHeader?.appendChild(headerActions);

    const clientTable = createTable(
        ['Client', 'Stock Total (kg)', 'Stock Net Produit (kg)', 'Box Plastique', 'Box Bois'],
        clients.map(client => {
            const summary = getClientStockSummary(client.id);
            const nameCell = createElement('td');
            const expandIcon = createElement('span', { className: 'expand-icon', textContent: '+' });
            const clientName = createElement('span', { textContent: ` ${client.name}` });
            nameCell.append(expandIcon, clientName);
            
            const clientRow = createElement('tr', { className: 'expandable' });
            clientRow.append(
                nameCell,
                createElement('td', { textContent: formatNumber(summary.totalWeight) + ' kg' }),
                createElement('td', { textContent: formatNumber(summary.productWeight) + ' kg' }),
                createElement('td', { textContent: summary.plasticBoxes.toString() }),
                createElement('td', { textContent: summary.woodBoxes.toString() })
            );
            clientRow.addEventListener('click', () => toggleClientStockDetails(clientRow, client.id, 5));
            return clientRow;
        })
    );
    if(clients.length === 0){
        clientStockPanel.appendChild(createEmptyState('Aucun client n\'a été créé pour le moment.'));
    } else {
        clientStockPanel.appendChild(clientTable);
    }
    
    main.append(filterContainer, statsGrid, chartsGrid, clientStockPanel);

    // --- RENDER CHARTS (after appending canvases to DOM) ---
    setTimeout(() => {
        // Trend Chart Logic
        const dailyData = new Map<string, { in: number, out: number }>();
        filteredMovements.forEach(m => {
            const entry = dailyData.get(m.date) || { in: 0, out: 0 };
            if (m.type === 'in') entry.in += m.productWeight;
            else entry.out += m.productWeight;
            dailyData.set(m.date, entry);
        });

        const sortedDates = Array.from(dailyData.keys()).sort();
        const trendLabels = sortedDates.map(date => formatDate(date));
        const trendDataIn = sortedDates.map(date => dailyData.get(date)!.in);
        const trendDataOut = sortedDates.map(date => dailyData.get(date)!.out);

        if (sortedDates.length > 0) {
            movementTrendChart = new Chart(trendCanvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: trendLabels,
                    datasets: [
                        { label: 'Entrées (kg)', data: trendDataIn, borderColor: 'rgba(92, 184, 92, 1)', backgroundColor: 'rgba(92, 184, 92, 0.2)', fill: true, tension: 0.3 },
                        { label: 'Sorties (kg)', data: trendDataOut, borderColor: 'rgba(217, 83, 79, 1)', backgroundColor: 'rgba(217, 83, 79, 0.2)', fill: true, tension: 0.3 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        } else {
            trendChartContainer.replaceChild(createEmptyState('Aucun mouvement de stock sur cette période.'), trendCanvas);
        }

        // Top Products Chart Logic
        const productTotals = new Map<string, number>();
        stockMovements.forEach(m => {
            const currentStock = productTotals.get(m.product) || 0;
            productTotals.set(m.product, currentStock + (m.productWeight * (m.type === 'in' ? 1 : -1)));
        });

        const sortedProducts = Array.from(productTotals.entries())
            .filter(([, weight]) => weight > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        if (sortedProducts.length > 0) {
            topProductsChart = new Chart(topProductsCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: sortedProducts.map(p => p[0]),
                    datasets: [{
                        label: 'Stock Net (kg)',
                        data: sortedProducts.map(p => p[1]),
                        backgroundColor: 'rgba(74, 144, 226, 0.6)',
                        borderColor: 'rgba(74, 144, 226, 1)',
                        borderWidth: 1
                    }]
                },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
            });
        } else {
            topProductsContainer.replaceChild(createEmptyState('Aucun produit en stock actuellement.'), topProductsCanvas);
        }
    }, 0);

    return main;
}


function renderReceptionistDashboard(): HTMLElement {
    const main = createElement('main', { className: 'main-content' });
    if (!currentUser) return main;

    const today = new Date().toISOString().split('T')[0];
    const myMovementsToday = stockMovements.filter(m => m.recordedByUserId === currentUser!.id && m.date === today);

    const movementsCount = myMovementsToday.length;
    const stockInToday = myMovementsToday
        .filter(m => m.type === 'in')
        .reduce((sum, m) => sum + m.productWeight, 0);
    const stockOutToday = myMovementsToday
        .filter(m => m.type === 'out')
        .reduce((sum, m) => sum + m.productWeight, 0);
    
    // Stats for personal activity
    const statsGrid = createElement('div', { className: 'stats-grid' });
    const stats = [
        { title: 'Mouvements saisis (Aujourd\'hui)', value: movementsCount.toString() },
        { title: 'Entrées Produit Net (Aujourd\'hui)', value: `+${formatNumber(stockInToday)} kg`, class: 'in' },
        { title: 'Sorties Produit Net (Aujourd\'hui)', value: `-${formatNumber(stockOutToday)} kg`, class: 'out' },
    ];

    stats.forEach(stat => {
        const card = createElement('div', { className: 'stat-card' });
        const titleEl = createElement('h3', { className: 'stat-card-title', textContent: stat.title });
        const valueEl = createElement('p', { className: 'stat-card-value', textContent: stat.value });
        if (stat.class) valueEl.classList.add(stat.class);
        card.append(titleEl, valueEl);
        statsGrid.appendChild(card);
    });

    // Client stock summary panel
    const stockPanel = createPanelWithTitle('État des Stocks par Client');
    const stockTable = createTable(
        ['Client', 'Stock Net (kg)', 'Stock Total (kg)', 'Box Plastique', 'Box Bois'],
        clients.map(client => {
            const summary = getClientStockSummary(client.id);
            const nameCell = createElement('td');
            const expandIcon = createElement('span', { className: 'expand-icon', textContent: '+' });
            const clientName = createElement('span', { textContent: ` ${client.name}` });
            nameCell.append(expandIcon, clientName);
            
            const clientRow = createElement('tr', { className: 'expandable' });
            clientRow.append(
                nameCell,
                createElement('td', { textContent: formatNumber(summary.productWeight) }),
                createElement('td', { textContent: formatNumber(summary.totalWeight) }),
                createElement('td', { textContent: summary.plasticBoxes.toString() }),
                createElement('td', { textContent: summary.woodBoxes.toString() })
            );
            clientRow.addEventListener('click', () => toggleClientStockDetails(clientRow, client.id, 5));
            return clientRow;
        })
    );
    if(clients.length === 0){
        stockPanel.appendChild(createEmptyState('Aucun client à afficher.'));
    } else {
        stockPanel.appendChild(stockTable);
    }
    
    // Recent personal movements panel
    const recentMovementsPanel = createPanelWithTitle('Vos Saisies Récentes');
    const myRecentMovements = stockMovements
        .filter(m => m.recordedByUserId === currentUser!.id)
        .reverse()
        .slice(0, 5);
        
    const recentMovementsTable = createTable(
        ['Date', 'Client', 'Produit', 'Type', 'Poids Total (kg)'],
        myRecentMovements.map(m => [
            formatDate(m.date),
            getClientNameById(m.clientId),
            m.product,
            m.type === 'in' ? 'Entrée' : 'Sortie',
            formatNumber(m.totalWeight)
        ])
    );
    if(myRecentMovements.length === 0){
        recentMovementsPanel.appendChild(createEmptyState('Vous n\'avez pas encore saisi de mouvement.'));
    } else {
        recentMovementsPanel.appendChild(recentMovementsTable);
    }

    main.append(statsGrid, stockPanel, recentMovementsPanel);
    return main;
}


function renderClientsPage(): HTMLElement {
    const main = createElement('main', { className: 'main-content' });
    const panel = createPanelWithTitle('Tous les clients');
    
    if (currentUser?.role === 'Réceptionniste' || currentUser?.role === 'Admin') {
        const button = createElement('button', {className: 'btn btn-primary', textContent: 'Ajouter un client'});
        button.addEventListener('click', () => {
            openModal(renderClientFormModal());
        });
        panel.querySelector('.panel-header')?.appendChild(button);
    }
    
    const table = createTable(
        ['ID Client', 'Nom / Raison Sociale', 'Téléphone', 'Actions'],
        clients.map(c => {
            const manageButton = createElement('button', { className: 'btn btn-info btn-sm', textContent: 'Gérer' });
            manageButton.addEventListener('click', () => {
                const modalContent = renderClientDetailModal(c);
                openModal(modalContent);
            });
            return [c.id.toString(), c.name, c.phone, manageButton];
        })
    );

    if (clients.length === 0) {
        panel.appendChild(createEmptyState('Aucun client n\'a été créé. Cliquez sur "Ajouter un client" pour commencer.'));
    } else {
        panel.appendChild(table);
    }
    
    main.appendChild(panel);
    return main;
}

function updateMovementsTable() {
    const wrapper = document.getElementById('movements-table-wrapper');
    if (wrapper) {
        wrapper.innerHTML = '';
        wrapper.appendChild(getFilteredMovementsTableNode());
    }
}

function getFilteredMovements(): StockMovement[] {
    return [...stockMovements].reverse().filter(m => {
        const { startDate, endDate, clientId, product, recordedByUserId } = movementFilters;
        if (startDate && m.date < startDate) return false;
        if (endDate && m.date > endDate) return false;
        if (clientId.length > 0 && !clientId.includes(m.clientId.toString())) return false;
        if (product.length > 0 && !product.includes(m.product)) return false;
        if (recordedByUserId.length > 0 && !recordedByUserId.includes(m.recordedByUserId.toString())) return false;
        return true;
    });
}

function getFilteredMovementsTableNode(): HTMLElement {
    const filteredMovements = getFilteredMovements();

    if (filteredMovements.length === 0) {
        return createEmptyState('Aucun mouvement ne correspond à vos filtres.');
    }

    const headers: (string|HTMLElement)[] = ['Date', 'Client', 'Produit', 'Type', 'Poids Total (kg)', 'Poids Net (kg)', 'Détails Box'];
    if (currentUser?.role === 'Admin' || currentUser?.role === 'Réceptionniste') {
        headers.push('Anomalie Signalée');
    }
    if (currentUser?.role === 'Admin') {
        headers.push('Saisie par');
    }
    headers.push('Actions');


    const tableData = filteredMovements.map(m => {
        const boxDetails: string[] = [];
        if (m.plasticBoxCount && m.plasticBoxCount > 0) {
            boxDetails.push(`P: ${m.plasticBoxCount}x${m.plasticBoxWeight}kg`);
        }
        if (m.woodBoxCount && m.woodBoxCount > 0) {
            boxDetails.push(`B: ${m.woodBoxCount}x${m.woodBoxWeight}kg`);
        }

        const row: (string | HTMLElement)[] = [
            formatDate(m.date),
            getClientNameById(m.clientId),
            m.product,
            m.type === 'in' ? 'Entrée' : 'Sortie',
            formatNumber(m.totalWeight),
            formatNumber(m.productWeight),
            boxDetails.join(' / ') || 'N/A'
        ];
        
        if (currentUser?.role === 'Admin' || currentUser?.role === 'Réceptionniste') {
            if (m.farmerComment) {
                const viewButton = createElement('button', {
                    className: 'btn btn-info btn-sm',
                    textContent: 'Voir'
                });
                if (!m.isCommentRead && m.recordedByUserId === currentUser.id) {
                    viewButton.classList.add('btn-pulsing');
                }
                viewButton.onclick = () => {
                    openModal(renderViewCommentModal(m));
                };
                row.push(viewButton);
            } else {
                row.push('Aucune');
            }
        }
        
        if (currentUser?.role === 'Admin') {
            row.push(getUserNameById(m.recordedByUserId));
        }

        const actionButtons = createElement('div', { className: 'action-buttons' });
        row.push(actionButtons);
        
        return row;
    });

    return createTable(headers, tableData);
}

function renderMultiSelectCheckbox(
    options: { value: string, text: string }[],
    selectedValues: string[],
    placeholder: string,
    allText: string,
    updateFn: (selected: string[]) => void
): HTMLElement {
    const container = createElement('div', { className: 'multiselect-container' });
    const display = createElement('div', { className: 'multiselect-display', tabIndex: 0 });
    const dropdown = createElement('div', { className: 'multiselect-dropdown' });

    const updateDisplayText = () => {
        if (selectedValues.length === 0 || selectedValues.length === options.length) {
            display.textContent = allText;
        } else if (selectedValues.length === 1) {
            const selectedOption = options.find(opt => opt.value === selectedValues[0]);
            display.textContent = selectedOption ? selectedOption.text : placeholder;
        } else {
            display.textContent = `${selectedValues.length} ${placeholder} sélectionnés`;
        }
    };

    display.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = container.classList.contains('active');
        // Close all other dropdowns
        document.querySelectorAll('.multiselect-container.active').forEach(el => el.classList.remove('active'));
        if (!isActive) {
            container.classList.add('active');
        }
    });

    options.forEach(option => {
        const item = createElement('div', { className: 'multiselect-item' });
        const checkbox = createElement('input', { type: 'checkbox', id: `ms-${placeholder}-${option.value}`, 'data-value': option.value });
        checkbox.checked = selectedValues.includes(option.value);
        
        const label = createElement('label', { htmlFor: `ms-${placeholder}-${option.value}`, textContent: option.text });

        item.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent dropdown from closing

            // Let browser handle toggle for checkbox/label clicks.
            // Manually toggle only if the click is on the padding of the item div.
            if (e.target === item) {
                checkbox.checked = !checkbox.checked;
            }
            
            const currentlySelected = Array.from(dropdown.querySelectorAll('input:checked')).map(cb => (cb as HTMLInputElement).dataset.value!);
            
            updateFn(currentlySelected);
            updateDisplayText();
            updateMovementsTable();
        });

        item.append(checkbox, label);
        dropdown.appendChild(item);
    });

    updateDisplayText();
    container.append(display, dropdown);
    return container;
}


function renderMovementFilters(): HTMLElement {
    const container = createElement('div', { className: 'filters-container' });

    const handleFilterChange = (key: 'startDate' | 'endDate', value: string) => {
        movementFilters[key] = value;
        updateMovementsTable();
    };

    // Date filters
    const dateGroup = createElement('div', {className: 'filter-group'});
    dateGroup.append(
        createElement('label', {textContent: 'De'}),
        createElement('input', { type: 'date', value: movementFilters.startDate, oninput: (e: Event) => handleFilterChange('startDate', (e.target as HTMLInputElement).value) }),
        createElement('label', {textContent: 'À'}),
        createElement('input', { type: 'date', value: movementFilters.endDate, oninput: (e: Event) => handleFilterChange('endDate', (e.target as HTMLInputElement).value) })
    );
    
    // Client filter
    const clientGroup = createElement('div', { className: 'filter-group' });
    const clientOptions = clients.map(c => ({ value: c.id.toString(), text: c.name }));
    const clientSelect = renderMultiSelectCheckbox(
        clientOptions,
        movementFilters.clientId,
        'clients',
        'Tous les clients',
        (selected) => { movementFilters.clientId = selected; }
    );
    clientGroup.append(createElement('label', { textContent: 'Client' }), clientSelect);

    // Product filter
    const productGroup = createElement('div', { className: 'filter-group' });
    const uniqueProducts = [...new Set(stockMovements.map(m => m.product))].sort();
    const productOptions = uniqueProducts.map(p => ({ value: p, text: p }));
    const productSelect = renderMultiSelectCheckbox(
        productOptions,
        movementFilters.product,
        'produits',
        'Tous les produits',
        (selected) => { movementFilters.product = selected; }
    );
    productGroup.append(createElement('label', { textContent: 'Produit' }), productSelect);

    container.append(dateGroup, clientGroup, productGroup);
    
    // Admin-only filter for user
    if (currentUser?.role === 'Admin') {
        const userGroup = createElement('div', { className: 'filter-group' });
        const userOptions = users.map(u => ({ value: u.id.toString(), text: u.name }));
        const userSelect = renderMultiSelectCheckbox(
            userOptions,
            movementFilters.recordedByUserId,
            'utilisateurs',
            'Tous les utilisateurs',
            (selected) => { movementFilters.recordedByUserId = selected; }
        );
        userGroup.append(createElement('label', { textContent: 'Saisie par' }), userSelect);
        container.append(userGroup);
    }
    
    // Reset button
    const actionsGroup = createElement('div', {className: 'filter-group'});
    const resetButton = createElement('button', { className: 'btn btn-secondary', textContent: 'Réinitialiser' });
    resetButton.onclick = () => {
        movementFilters = getInitialMovementFilters();
        renderApp();
    };
    actionsGroup.append(resetButton);

    container.append(actionsGroup);

    return container;
}

function handleExportCSV() {
    const data = getFilteredMovements();
    if (data.length === 0) {
        showToast("Aucune donnée à exporter.", 'info');
        return;
    }

    const headers = [
        "ID Mouvement", "Date", "Client", "Produit", "Type", 
        "Poids Total (kg)", "Poids Net Produit (kg)", 
        "Nb. Box Plastique", "Poids Unit. Plastique (kg)",
        "Nb. Box Bois", "Poids Unit. Bois (kg)",
        "Saisie par", "Commentaire Réceptionniste", "Commentaire Agriculteur"
    ];

    const csvRows = [headers.join(',')];

    data.forEach(m => {
        const row = [
            m.id,
            m.date,
            `"${getClientNameById(m.clientId)}"`,
            `"${m.product}"`,
            m.type === 'in' ? 'Entrée' : 'Sortie',
            m.totalWeight,
            m.productWeight,
            m.plasticBoxCount || 0,
            m.plasticBoxWeight || 0,
            m.woodBoxCount || 0,
            m.woodBoxWeight || 0,
            `"${getUserNameById(m.recordedByUserId)}"`,
            `"${(m.comment || '').replace(/"/g, '""')}"`,
            `"${(m.farmerComment || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `export_mouvements_${today}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renderMovementsPage(): HTMLElement {
    const main = createElement('main', { className: 'main-content' });
    const panel = createPanelWithTitle('Tous les mouvements de stock');
    panel.id = 'movements-panel';

    const panelHeader = panel.querySelector('.panel-header') as HTMLElement;

    const headerActions = createElement('div', { className: 'panel-header-actions' });
    
    if (currentUser?.role === 'Réceptionniste' || currentUser?.role === 'Admin') {
        const addMovementButton = createElement('button', {className: 'btn btn-primary', textContent: 'Enregistrer un mouvement'});
        addMovementButton.addEventListener('click', () => {
            openModal(renderMovementFormModal());
        });
        headerActions.appendChild(addMovementButton);
    }

    const exportCsvButton = createElement('button', { className: 'btn btn-secondary', textContent: 'Exporter CSV' });
    exportCsvButton.addEventListener('click', handleExportCSV);
    
    headerActions.append(exportCsvButton);
    panelHeader?.appendChild(headerActions);


    // Add filters
    const filtersPanel = renderMovementFilters();
    
    // Add stable wrapper for the table
    const tableWrapper = createElement('div', { id: 'movements-table-wrapper' });
    tableWrapper.appendChild(getFilteredMovementsTableNode()); // Initial table render

    panel.append(filtersPanel, tableWrapper);
    main.appendChild(panel);
    return main;
}


async function handleSuspendToggle(userId: number) {
    const user = users.find(u => u.id === userId);
    if (user) {
        const newStatus = user.status === 'Active' ? 'Suspended' : 'Active';
        try {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            if (!response.ok) throw new Error('Failed to update user status.');
            
            const updatedUser = await response.json();
            const userIndex = users.findIndex(u => u.id === userId);
            if (userIndex > -1) {
                users[userIndex] = updatedUser;
            }
            renderApp();
            showToast(`Utilisateur ${newStatus === 'Active' ? 'réactivé' : 'suspendu'}.`, 'success');
        } catch (error) {
            console.error(error);
            showToast('Impossible de mettre à jour le statut.', 'error');
        }
    }
}

async function handleDeleteUser(userId: number, userName: string) {
    showConfirmationModal(
        'Confirmer la suppression',
        `Êtes-vous sûr de vouloir supprimer définitivement l'utilisateur "${userName}" ? Cette action est irréversible.`,
        async () => {
            try {
                const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Failed to delete user.');
                }
                users = users.filter(u => u.id !== userId);
                renderApp();
                showToast(`Utilisateur "${userName}" supprimé.`, 'success');
            } catch (error: any) {
                console.error(error);
                showToast(`Impossible de supprimer l'utilisateur: ${error.message}`, 'error');
            }
        }
    );
}


function renderUsersPage(): HTMLElement {
    const main = createElement('main', { className: 'main-content' });
    const panel = createPanelWithTitle('Tous les utilisateurs');

    if (currentUser?.role === 'Admin') {
        const button = createElement('button', { className: 'btn btn-primary', textContent: 'Ajouter un utilisateur' });
        button.addEventListener('click', () => {
            openModal(renderUserFormModal());
        });
        panel.querySelector('.panel-header')?.appendChild(button);
    }

    const table = createTable(
        ['ID', 'Nom', 'Rôle', 'Statut', 'Actions'],
        users.map(u => {
            const statusBadge = createElement('span', {
                className: `status-badge ${u.status === 'Active' ? 'status-active' : 'status-suspended'}`,
                textContent: u.status === 'Active' ? 'Actif' : 'Suspendu'
            });

            const actionButtons = createElement('div', { className: 'action-buttons' });

            const manageButton = createElement('button', {
                className: 'btn btn-info btn-sm manage-user-btn',
                textContent: 'Gérer',
                'data-user-id': u.id
            });
            actionButtons.appendChild(manageButton);

            if (u.id !== currentUser?.id && u.role !== 'Admin') {
                const suspendButton = createElement('button', {
                    className: `btn btn-sm suspend-user-btn ${u.status === 'Active' ? 'btn-warning' : 'btn-success'}`,
                    textContent: u.status === 'Active' ? 'Suspendre' : 'Réactiver',
                    'data-user-id': u.id
                });
                actionButtons.appendChild(suspendButton);

                const deleteButton = createElement('button', {
                    className: 'btn btn-danger btn-sm delete-user-btn',
                    textContent: 'Supprimer',
                    'data-user-id': u.id,
                    'data-user-name': u.name
                });
                actionButtons.appendChild(deleteButton);
            }

            return [u.id.toString(), u.name, u.role, statusBadge, actionButtons];
        })
    );

    // Event Delegation for action buttons
    const tbody = table.querySelector('tbody');
    if (tbody) {
        tbody.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;

            const manageBtn = target.closest('.manage-user-btn');
            if (manageBtn) {
                const userId = parseInt(manageBtn.getAttribute('data-user-id')!, 10);
                const user = users.find(u => u.id === userId);
                if (user) openModal(renderUserFormModal(user));
                return;
            }

            const suspendBtn = target.closest('.suspend-user-btn');
            if (suspendBtn) {
                const userId = parseInt(suspendBtn.getAttribute('data-user-id')!, 10);
                handleSuspendToggle(userId);
                return;
            }

            const deleteBtn = target.closest('.delete-user-btn');
            if (deleteBtn) {
                const userId = parseInt(deleteBtn.getAttribute('data-user-id')!, 10);
                const userName = deleteBtn.getAttribute('data-user-name')!;
                handleDeleteUser(userId, userName);
                return;
            }
        });
    }

    if (users.length === 0) {
        panel.appendChild(createEmptyState('Aucun utilisateur n\'a été créé.'));
    } else {
        panel.appendChild(table);
    }
    
    main.appendChild(panel);
    return main;
}


function renderFarmerStockPage(): HTMLElement {
    const main = createElement('main', { className: 'main-content' });
    if (!currentUser || !currentUser.clientId) return main;

    const farmerClientId = currentUser.clientId;
    const summary = getClientStockSummary(farmerClientId);

    // Stock Summary Cards
    const statsGrid = createElement('div', { className: 'stats-grid' });
    const stockStats = [
      { title: 'Poids Total en Stock', value: `${formatNumber(summary.totalWeight)} kg` },
      { title: 'Poids Net Produit', value: `${formatNumber(summary.productWeight)} kg` },
      { title: 'Box Plastique', value: summary.plasticBoxes.toString() },
      { title: 'Box Bois', value: summary.woodBoxes.toString() },
    ];

    stockStats.forEach(stat => {
        const card = createElement('div', { className: 'stat-card' });
        const titleEl = createElement('h3', { className: 'stat-card-title', textContent: stat.title });
        const valueEl = createElement('p', { className: 'stat-card-value', textContent: stat.value });
        card.append(titleEl, valueEl);
        statsGrid.appendChild(card);
    });
    
    // Movements History Panel
    const movementsPanel = createPanelWithTitle('Historique de vos mouvements');
    const farmerMovements = stockMovements.filter(m => m.clientId === farmerClientId);
    
    const tableData = [...farmerMovements].reverse().map(m => {
        const actionButton = createElement('button', { 
            className: `btn btn-sm ${m.farmerComment ? 'btn-secondary' : 'btn-warning'}`,
            textContent: m.farmerComment ? 'Modifier Commentaire' : 'Signaler Anomalie'
        });
        actionButton.onclick = () => openModal(renderFarmerCommentModal(m));
        
        const weightChange = (m.type === 'in' ? '+' : '-') + formatNumber(m.productWeight);

        return [
            formatDate(m.date),
            m.product,
            m.type === 'in' ? 'Entrée' : 'Sortie',
            weightChange,
            actionButton
        ];
    });

    const table = createTable(
        ['Date', 'Produit', 'Type', 'Poids Net Produit (kg)', 'Actions'],
        tableData
    );
    if(farmerMovements.length === 0){
        movementsPanel.appendChild(createEmptyState('Vous n\'avez encore aucun mouvement de stock.'));
    } else {
        movementsPanel.appendChild(table);
    }

    main.append(statsGrid, movementsPanel);
    return main;
}

// --- HELPER UI COMPONENTS ---

function renderClientDetailModal(client: Client): HTMLElement {
    const content = createElement('div', { className: 'modal-content' });

    const header = createElement('div', { className: 'modal-header' });
    const title = createElement('h2', { textContent: `Détails pour ${client.name}` });
    const closeBtn = createElement('button', { className: 'modal-close-btn', textContent: '×' });
    closeBtn.addEventListener('click', closeModal);
    header.append(title, closeBtn);

    const body = createElement('div', { className: 'modal-body' });
    const stockSummary = getClientStockSummary(client.id);
    
    // General Info
    const infoSection = createElement('div');
    infoSection.innerHTML = `
        <p><strong>ID Client:</strong> ${client.id}</p>
        <p><strong>Type:</strong> ${client.type === 'particulier' ? 'Particulier' : 'Personne Morale'}</p>
        <p><strong>${client.type === 'particulier' ? 'Nom complet' : 'Raison Sociale'}:</strong> ${client.name}</p>
        <p><strong>Téléphone:</strong> ${client.phone}</p>
        <p><strong>Email:</strong> ${client.email}</p>
        <p><strong>Adresse:</strong> ${client.address}</p>
        ${client.comment ? `<p><strong>Commentaire:</strong> ${client.comment}</p>` : ''}
        <hr style="margin: 1rem 0; border: 0; border-top: 1px solid var(--border-color);">
        <p><strong>Inscrit le:</strong> ${formatDate(client.joinDate)}</p>
        <p><strong>Compte Agriculteur lié:</strong> ${users.some(u => u.clientId === client.id) ? 'Oui' : 'Non'}</p>
        <p><strong>Stock Total:</strong> ${formatNumber(stockSummary.totalWeight)} kg</p>
        <p><strong>Stock Net Produit:</strong> ${formatNumber(stockSummary.productWeight)} kg</p>
        <p><strong>Box Plastique en stock:</strong> ${stockSummary.plasticBoxes}</p>
        <p><strong>Box Bois en stock:</strong> ${stockSummary.woodBoxes}</p>
    `;

    // Recent Movements
    const movementsSection = createElement('div');
    const movementsTitle = createElement('h3', { textContent: 'Mouvements Récents' });
    const clientMovements = stockMovements.filter(m => m.clientId === client.id).reverse().slice(0, 5);
    const movementsTable = createTable(
        ['Date', 'Produit', 'Type', 'Poids Net', 'Poids Total'],
        clientMovements.map(m => [formatDate(m.date), m.product, m.type === 'in' ? 'Entrée' : 'Sortie', formatNumber(m.productWeight) + ' kg', formatNumber(m.totalWeight) + ' kg'])
    );
    
    if(clientMovements.length > 0) {
        movementsSection.append(movementsTitle, movementsTable);
    } else {
        movementsSection.append(movementsTitle, createEmptyState('Aucun mouvement récent pour ce client.'));
    }
    

    body.append(infoSection, movementsSection);
    content.append(header, body);

    return content;
}

async function handleClientSave(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submitBtn) return;
    
    const formData = new FormData(form);
    const type = formData.get('type') as Client['type'];
    const name = (formData.get('name') as string)?.trim();
    const phone = (formData.get('phone') as string)?.trim();
    const address = (formData.get('address') as string)?.trim();
    const email = (formData.get('email') as string)?.trim();
    const comment = (formData.get('comment') as string)?.trim();

    if (!type || !name || !phone || !address || !email) {
        showToast('Veuillez remplir tous les champs obligatoires.', 'warning');
        return;
    }
    
    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Création...`;

    const newClientData = { 
        name, 
        type,
        phone,
        address,
        email,
        comment: comment ? comment : undefined,
    };

    try {
        const response = await fetch('/api/clients', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(newClientData),
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Erreur du serveur: ${response.statusText}`);
        }

        const savedClient: Client = await response.json();
        clients.push(savedClient);
        
        closeModal();
        renderApp();
        showToast('Client créé avec succès!', 'success');
    } catch (error: any) {
        showToast(`Impossible de sauvegarder le client: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}


function renderClientFormModal(): HTMLElement {
    const content = createElement('div', { className: 'modal-content' });

    const header = createElement('div', { className: 'modal-header' });
    const title = createElement('h2', { textContent: 'Ajouter un nouveau client' });
    const closeBtn = createElement('button', { className: 'modal-close-btn', textContent: '×' });
    closeBtn.addEventListener('click', closeModal);
    header.append(title, closeBtn);

    const body = createElement('div', { className: 'modal-body' });
    const form = createElement('form');
    form.addEventListener('submit', handleClientSave);
    
    // Type group
    const typeGroup = createElement('div', { className: 'form-group' });
    const typeLabel = createElement('label', { htmlFor: 'client-type', textContent: 'Type de client' });
    const typeSelect = createElement('select', { id: 'client-type', name: 'type', required: true }) as HTMLSelectElement;
    typeSelect.append(
        createElement('option', { value: 'personne morale', textContent: 'Personne Morale' }),
        createElement('option', { value: 'particulier', textContent: 'Particulier' })
    );
    typeGroup.append(typeLabel, typeSelect);
    
    // Name group
    const nameGroup = createElement('div', { className: 'form-group' });
    const nameLabel = createElement('label', { htmlFor: 'client-name', textContent: 'Raison sociale' });
    const nameInput = createElement('input', { type: 'text', id: 'client-name', name: 'name', placeholder: 'ex: Les Vergers du Soleil', required: true }) as HTMLInputElement;
    nameGroup.append(nameLabel, nameInput);

    // Change label based on type
    typeSelect.addEventListener('change', () => {
        nameLabel.textContent = typeSelect.value === 'particulier' ? 'Nom complet' : 'Raison sociale';
        nameInput.placeholder = typeSelect.value === 'particulier' ? 'ex: Jean Dupont' : 'ex: Les Vergers du Soleil';
    });

    // Phone & Email group (inline)
    const contactGroup = createElement('div', { className: 'form-group-inline' });

    const phoneGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    const phoneLabel = createElement('label', { htmlFor: 'client-phone', textContent: 'Téléphone' });
    const phoneInput = createElement('input', { type: 'tel', id: 'client-phone', name: 'phone', placeholder: 'ex: 0123456789', required: true });
    phoneGroup.append(phoneLabel, phoneInput);
    
    const emailGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    const emailLabel = createElement('label', { htmlFor: 'client-email', textContent: 'Email' });
    const emailInput = createElement('input', { type: 'email', id: 'client-email', name: 'email', placeholder: 'ex: contact@exemple.com', required: true });
    emailGroup.append(emailLabel, emailInput);
    
    contactGroup.append(phoneGroup, emailGroup);

    // Address group
    const addressGroup = createElement('div', { className: 'form-group' });
    const addressLabel = createElement('label', { htmlFor: 'client-address', textContent: 'Adresse' });
    const addressInput = createElement('input', { type: 'text', id: 'client-address', name: 'address', placeholder: 'ex: 1 Rue de la Paix, 75001 Paris', required: true });
    addressGroup.append(addressLabel, addressInput);
    
    // Comment group
    const commentGroup = createElement('div', { className: 'form-group' });
    const commentLabel = createElement('label', { htmlFor: 'client-comment', textContent: 'Commentaire (optionnel)' });
    const commentTextarea = createElement('textarea', { id: 'client-comment', name: 'comment', rows: '3', placeholder: 'Ajouter une note sur le client...' });
    commentGroup.append(commentLabel, commentTextarea);


    const footer = createElement('div', { className: 'modal-footer' });
    const submitBtn = createElement('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Créer le client' });
    footer.appendChild(submitBtn);

    form.append(typeGroup, nameGroup, contactGroup, addressGroup, commentGroup, footer);
    body.appendChild(form);
    content.append(header, body);
    
    return content;
}

async function handleMovementSave(event: Event) {
    event.preventDefault();
    if (!currentUser) return;
    const form = event.target as HTMLFormElement;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submitBtn) return;
    
    const formData = new FormData(form);
    const clientId = parseInt(formData.get('clientId') as string);
    const type = formData.get('type') as 'in' | 'out';
    const product = (formData.get('product') as string)?.trim();
    const totalWeight = parseFloat(formData.get('totalWeight') as string);
    const comment = formData.get('comment') as string;

    if (!clientId || !product || !type || isNaN(totalWeight) || totalWeight <= 0) {
        showToast('Veuillez remplir correctement les champs Client, Produit, Type et Poids Total.', 'warning');
        return;
    }
    
    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Enregistrement...`;

    const movementData = {
        clientId,
        type,
        product,
        totalWeight,
        plasticBoxCount: parseInt(formData.get('plasticBoxCount') as string) || 0,
        plasticBoxWeight: parseFloat(formData.get('plasticBoxWeight') as string) || 0,
        woodBoxCount: parseInt(formData.get('woodBoxCount') as string) || 0,
        woodBoxWeight: parseFloat(formData.get('woodBoxWeight') as string) || 0,
        comment,
        recordedByUserId: currentUser.id,
    };

    try {
        const response = await fetch('/api/movements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(movementData)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Une erreur est survenue lors de la sauvegarde.');
        }

        stockMovements.push(result);
        closeModal();
        renderApp();
        showToast('Mouvement enregistré avec succès!', 'success');

    } catch (error: any) {
        showToast(`Erreur: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}


function renderMovementFormModal(): HTMLElement {
    const content = createElement('div', { className: 'modal-content' });

    const header = createElement('div', { className: 'modal-header' });
    const title = createElement('h2', { textContent: 'Enregistrer un mouvement de stock' });
    const closeBtn = createElement('button', { className: 'modal-close-btn', textContent: '×' });
    closeBtn.addEventListener('click', closeModal);
    header.append(title, closeBtn);

    const body = createElement('div', { className: 'modal-body' });
    const form = createElement('form');
    form.addEventListener('submit', handleMovementSave);
    
    // --- TOP PART (Client, Product, Type) ---
    const topGroup = createElement('div', { className: 'form-group-inline' });
    
    const clientGroup = createElement('div', { className: 'form-group', style: 'flex: 2;' });
    const clientLabel = createElement('label', { htmlFor: 'movement-client', textContent: 'Client' });
    const clientSelect = createElement('select', { id: 'movement-client', name: 'clientId', required: true });
    clientSelect.append(createElement('option', { value: '', textContent: 'Sélectionner un client...' }));
    clients.forEach(client => clientSelect.appendChild(createElement('option', { value: client.id.toString(), textContent: client.name })));
    clientGroup.append(clientLabel, clientSelect);
    
    const typeGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    const typeLabel = createElement('label', { htmlFor: 'movement-type', textContent: 'Type' });
    const typeSelect = createElement('select', { id: 'movement-type', name: 'type', required: true });
    typeSelect.append(createElement('option', { value: 'in', textContent: 'Entrée' }), createElement('option', { value: 'out', textContent: 'Sortie' }));
    typeGroup.append(typeLabel, typeSelect);
    
    topGroup.append(clientGroup, typeGroup);
    
    // --- Product with Autocomplete ---
    const productGroup = createElement('div', { className: 'form-group product-autocomplete-group', style: 'position: relative;' });
    const productLabel = createElement('label', { htmlFor: 'movement-product', textContent: 'Nom du produit' });
    const productInput = createElement('input', { type: 'text', id: 'movement-product', name: 'product', placeholder: 'ex: Pommes Gala', required: true, autocomplete: 'off' });
    const suggestionsContainer = createElement('div', { className: 'autocomplete-suggestions' });
    productGroup.append(productLabel, productInput, suggestionsContainer);

    // --- Stock Info Displays ---
    const stockInfoDisplay = createElement('div', { className: 'stock-info-display' });

    const allProducts = [...new Set(stockMovements.map(m => m.product))].sort();
    
    const updateAvailableStockDisplays = () => {
        const selectedClientId = parseInt((clientSelect as HTMLSelectElement).value);
        const productName = (productInput as HTMLInputElement).value.trim();
        stockInfoDisplay.innerHTML = '';

        if (selectedClientId) {
            const summary = getClientStockSummary(selectedClientId);
            let infoHtml = `<strong>Stock dispo client :</strong> Box P: ${summary.plasticBoxes}, Box B: ${summary.woodBoxes}`;
            if (productName) {
                const availableStock = getProductStockForClient(selectedClientId, productName);
                infoHtml += `, Produit net: ${formatNumber(availableStock)} kg`;
            }
            stockInfoDisplay.innerHTML = infoHtml;
            stockInfoDisplay.style.display = 'block';
        } else {
            stockInfoDisplay.style.display = 'none';
        }
    };

    productInput.addEventListener('input', () => {
        const value = (productInput as HTMLInputElement).value.toLowerCase();
        suggestionsContainer.innerHTML = '';
        updateAvailableStockDisplays(); 

        if (!value) {
            suggestionsContainer.classList.remove('active');
            return;
        }

        const filteredProducts = allProducts.filter(p => p.toLowerCase().includes(value));

        if (filteredProducts.length > 0) {
            suggestionsContainer.classList.add('active');
            filteredProducts.forEach(p => {
                const item = createElement('div', { className: 'autocomplete-item' });
                const matchIndex = p.toLowerCase().indexOf(value);
                const boldPart = p.substring(matchIndex, matchIndex + value.length);
                item.innerHTML = p.substring(0, matchIndex) + `<strong>${boldPart}</strong>` + p.substring(matchIndex + value.length);
                
                item.addEventListener('click', () => {
                    (productInput as HTMLInputElement).value = p;
                    suggestionsContainer.classList.remove('active');
                    updateAvailableStockDisplays();
                });
                suggestionsContainer.appendChild(item);
            });
        } else {
            suggestionsContainer.classList.remove('active');
        }
    });

    clientSelect.addEventListener('change', updateAvailableStockDisplays);

    // --- Main Weight Input ---
    const totalWeightGroup = createElement('div', { className: 'form-group' });
    const totalWeightLabel = createElement('label', { htmlFor: 'movement-total-weight', textContent: 'Poids Total Brut (kg)' });
    const totalWeightInput = createElement('input', { type: 'number', id: 'movement-total-weight', name: 'totalWeight', step: '0.1', min: '0', placeholder: 'Poids total lu sur la balance', required: true });
    totalWeightGroup.append(totalWeightLabel, totalWeightInput);

    // --- Box Details Fieldset ---
    const boxFieldset = createElement('fieldset', { className: 'form-fieldset' });
    const boxLegend = createElement('legend', { textContent: 'Détails des Box (Optionnel)'});
    
    const plasticGroup = createElement('div', { className: 'form-group-inline' });
    const plasticCountGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    plasticCountGroup.append(createElement('label', { htmlFor: 'p-box-count', textContent: 'Nb. Box Plastique' }), createElement('input', { type: 'number', name: 'plasticBoxCount', id: 'p-box-count', min: '0' }));
    const plasticWeightGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    plasticWeightGroup.append(createElement('label', { htmlFor: 'p-box-weight', textContent: 'Poids unit. (kg)' }), createElement('input', { type: 'number', name: 'plasticBoxWeight', id: 'p-box-weight', step: '0.1', min: '0' }));
    plasticGroup.append(plasticCountGroup, plasticWeightGroup);

    const woodGroup = createElement('div', { className: 'form-group-inline' });
    const woodCountGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    woodCountGroup.append(createElement('label', { htmlFor: 'w-box-count', textContent: 'Nb. Box Bois' }), createElement('input', { type: 'number', name: 'woodBoxCount', id: 'w-box-count', min: '0' }));
    const woodWeightGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    woodWeightGroup.append(createElement('label', { htmlFor: 'w-box-weight', textContent: 'Poids unit. (kg)' }), createElement('input', { type: 'number', name: 'woodBoxWeight', id: 'w-box-weight', step: '0.1', min: '0' }));
    woodGroup.append(woodCountGroup, woodWeightGroup);
    
    boxFieldset.append(boxLegend, plasticGroup, woodGroup);

    // --- Net Weight Display ---
    const netWeightDisplay = createElement('div', { className: 'form-group total-weight-display' });
    netWeightDisplay.innerHTML = `<strong>Poids Net du produit :</strong> <span id="net-weight-value">0.00 kg</span>`;

    const updateNetWeight = () => {
        const tWeight = parseFloat((form.elements.namedItem('totalWeight') as HTMLInputElement).value) || 0;
        const pCount = parseInt((form.elements.namedItem('plasticBoxCount') as HTMLInputElement).value) || 0;
        const pWeight = parseFloat((form.elements.namedItem('plasticBoxWeight') as HTMLInputElement).value) || 0;
        const wCount = parseInt((form.elements.namedItem('woodBoxCount') as HTMLInputElement).value) || 0;
        const wWeight = parseFloat((form.elements.namedItem('woodBoxWeight') as HTMLInputElement).value) || 0;
        const netTotal = tWeight - (pCount * pWeight) - (wCount * wWeight);
        const displaySpan = document.getElementById('net-weight-value');
        if (displaySpan) {
            displaySpan.textContent = `${formatNumber(netTotal)} kg`;
            displaySpan.style.color = netTotal < 0 ? 'var(--danger-color)' : 'inherit';
        }
    };
    form.addEventListener('input', updateNetWeight);

    // --- Comment Field ---
    const commentGroup = createElement('div', { className: 'form-group' });
    const commentLabel = createElement('label', { htmlFor: 'movement-comment', textContent: 'Commentaire (optionnel)' });
    const commentTextarea = createElement('textarea', { id: 'movement-comment', name: 'comment', rows: '2', placeholder: 'Ajouter une note...' });
    commentGroup.append(commentLabel, commentTextarea);

    // --- Footer ---
    const footer = createElement('div', { className: 'modal-footer' });
    const submitBtn = createElement('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Enregistrer le mouvement' });
    footer.appendChild(submitBtn);

    form.append(topGroup, productGroup, stockInfoDisplay, totalWeightGroup, boxFieldset, netWeightDisplay, commentGroup, footer);
    body.appendChild(form);
    content.append(header, body);
    
    return content;
}

async function handleUserSave(event: Event, userToEdit?: User) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submitBtn) return;
    
    const formData = new FormData(form);
    const name = formData.get('name') as string;
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const role = formData.get('role') as User['role'];
    const clientId = formData.get('clientId') ? parseInt(formData.get('clientId') as string) : undefined;

    if (!name || !username || !role) {
        showToast('Veuillez remplir tous les champs obligatoires.', 'warning');
        return;
    }
    
    if (!userToEdit && !password) {
        showToast('Le mot de passe est obligatoire pour un nouvel utilisateur.', 'warning');
        return;
    }

    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Sauvegarde...`;

    const userData: Partial<User> & { password?: string } = { name, username, role, clientId: role === 'Agriculteur' ? clientId : undefined };
    if (password) {
        userData.password = password;
    }

    try {
        let response: Response;
        if (userToEdit) { // Editing existing user
            if (!password) {
                // If password is not provided in edit mode, don't send it.
                delete userData.password;
            }
            response = await fetch(`/api/users/${userToEdit.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData),
            });
        } else { // Adding new user
            response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData),
            });
        }
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to save user.');
        }

        const savedUser = await response.json();

        if (userToEdit) {
            const userIndex = users.findIndex(u => u.id === userToEdit.id);
            if (userIndex > -1) users[userIndex] = savedUser;
        } else {
            users.push(savedUser);
        }
        
        closeModal();
        renderApp();
        showToast(userToEdit ? 'Utilisateur mis à jour!' : 'Utilisateur créé!', 'success');

    } catch (error: any) {
        showToast(`Impossible de sauvegarder: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}


function renderUserFormModal(userToEdit?: User): HTMLElement {
    const isEditMode = userToEdit !== undefined;
    const content = createElement('div', { className: 'modal-content' });

    // Header
    const header = createElement('div', { className: 'modal-header' });
    const titleText = isEditMode ? `Modifier l'utilisateur : ${userToEdit.name}` : 'Ajouter un nouvel utilisateur';
    const title = createElement('h2', { textContent: titleText });
    const closeBtn = createElement('button', { className: 'modal-close-btn', textContent: '×' });
    closeBtn.addEventListener('click', closeModal);
    header.append(title, closeBtn);

    // Body
    const body = createElement('div', { className: 'modal-body' });
    const form = createElement('form');
    form.addEventListener('submit', (e) => handleUserSave(e, userToEdit));
    
    const mainFields = createElement('div', { className: 'form-group-inline'});

    // Name field
    const nameGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    const nameLabel = createElement('label', { htmlFor: 'user-name', textContent: 'Nom complet' });
    const nameInput = createElement('input', { type: 'text', id: 'user-name', name: 'name', value: userToEdit?.name ?? '', required: true });
    nameGroup.append(nameLabel, nameInput);

    // Username field
    const usernameGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    const usernameLabel = createElement('label', { htmlFor: 'user-username', textContent: 'Nom d\'utilisateur' });
    const usernameInput = createElement('input', { type: 'text', id: 'user-username', name: 'username', value: userToEdit?.username ?? '', required: true });
    usernameGroup.append(usernameLabel, usernameInput);
    
    mainFields.append(nameGroup, usernameGroup);

    // Password field
    const passwordGroup = createElement('div', { className: 'form-group' });
    const passwordLabel = createElement('label', { htmlFor: 'user-password', textContent: 'Nouveau mot de passe' });
    const passwordInput = createElement('input', { type: 'password', id: 'user-password', name: 'password', placeholder: isEditMode ? 'Laisser vide pour ne pas changer' : '••••••••••', required: !isEditMode });
    passwordGroup.append(passwordLabel, passwordInput);


    // Role and Client fields
    const roleClientGroup = createElement('div', { className: 'form-group-inline' });

    // Role select
    const roleGroup = createElement('div', { className: 'form-group', style: 'flex: 1;' });
    const roleLabel = createElement('label', { htmlFor: 'user-role', textContent: 'Rôle' });
    const roleSelect = createElement('select', { id: 'user-role', name: 'role', required: true });
    ['Admin', 'Réceptionniste', 'Agriculteur'].forEach(role => {
        const option = createElement('option', { value: role, textContent: role });
        if (userToEdit?.role === role) option.selected = true;
        roleSelect.appendChild(option);
    });
    roleGroup.append(roleLabel, roleSelect);

    // Client select (for farmers)
    const clientGroup = createElement('div', { className: 'form-group hidden', id: 'client-selector-group', style: 'flex: 1;' });
    const clientLabel = createElement('label', { htmlFor: 'user-client', textContent: 'Client lié' });
    const clientSelect = createElement('select', { id: 'user-client', name: 'clientId' });
    const defaultOption = createElement('option', { value: '', textContent: 'Sélectionner un client...' });
    clientSelect.appendChild(defaultOption);
    clients.forEach(client => {
        const option = createElement('option', { value: client.id.toString(), textContent: client.name });
        if (userToEdit?.clientId === client.id) option.selected = true;
        clientSelect.appendChild(option);
    });
    clientGroup.append(clientLabel, clientSelect);

    roleClientGroup.append(roleGroup, clientGroup);
    
    // Automatically fill name when a client is selected for the 'Agriculteur' role
    clientSelect.addEventListener('change', () => {
        if (roleSelect.value === 'Agriculteur') {
            const selectedClientId = parseInt(clientSelect.value, 10);
            const selectedClient = clients.find(c => c.id === selectedClientId);
            if (selectedClient) {
                (nameInput as HTMLInputElement).value = selectedClient.name;
            }
        }
    });

    // Show/hide client selector based on role
    const toggleClientSelector = () => {
        if (roleSelect.value === 'Agriculteur') {
            clientGroup.classList.remove('hidden');
            (clientSelect as HTMLSelectElement).required = true;
        } else {
            clientGroup.classList.add('hidden');
            (clientSelect as HTMLSelectElement).required = false;
        }
    };
    roleSelect.addEventListener('change', toggleClientSelector);
    // Initial check on load
    setTimeout(toggleClientSelector, 0);


    // Footer with submit button
    const footer = createElement('div', { className: 'modal-footer' });
    const submitBtn = createElement('button', { type: 'submit', className: 'btn btn-primary', textContent: isEditMode ? 'Sauvegarder les modifications' : 'Créer l\'utilisateur' });
    footer.appendChild(submitBtn);

    form.append(mainFields, passwordGroup, roleClientGroup, footer);
    body.appendChild(form);
    content.append(header, body);
    
    return content;
}

async function handleFarmerCommentSave(event: Event, movementId: number) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submitBtn) return;
    
    const formData = new FormData(form);
    const comment = formData.get('farmerComment') as string;

    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Envoi...`;

    try {
        const response = await fetch(`/api/movements/${movementId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farmerComment: comment.trim() })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Impossible d\'enregistrer le commentaire.');
        }

        const updatedMovement = await response.json();
        const index = stockMovements.findIndex(m => m.id === movementId);
        if (index > -1) {
            stockMovements[index] = updatedMovement;
        }

        closeModal();
        renderApp();
        showToast('Commentaire envoyé avec succès!', 'success');
    } catch (error: any) {
        showToast(`Erreur: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}

function renderFarmerCommentModal(movement: StockMovement): HTMLElement {
    const content = createElement('div', { className: 'modal-content' });

    // Header
    const header = createElement('div', { className: 'modal-header' });
    const title = createElement('h2', { textContent: 'Signaler une anomalie' });
    const closeBtn = createElement('button', { className: 'modal-close-btn', textContent: '×' });
    closeBtn.addEventListener('click', closeModal);
    header.append(title, closeBtn);

    // Body
    const body = createElement('div', { className: 'modal-body' });
    
    // Movement details
    const details = createElement('div', { className: 'movement-details-box' });
    details.innerHTML = `
        <p><strong>Mouvement du ${formatDate(movement.date)}</strong></p>
        <p>${movement.product} | ${movement.type === 'in' ? 'Entrée' : 'Sortie'} de ${formatNumber(movement.productWeight)} kg (net)</p>
    `;
    
    const form = createElement('form');
    form.addEventListener('submit', (e) => handleFarmerCommentSave(e, movement.id));

    const commentGroup = createElement('div', { className: 'form-group' });
    const commentLabel = createElement('label', { htmlFor: 'farmer-comment', textContent: 'Décrivez l\'anomalie ci-dessous :' });
    const commentTextarea = createElement('textarea', { id: 'farmer-comment', name: 'farmerComment', rows: '5', placeholder: 'ex: Le poids enregistré ne correspond pas à ma pesée...', required: true });
    commentTextarea.value = movement.farmerComment || '';
    commentGroup.append(commentLabel, commentTextarea);
    
    // Footer with submit button
    const footer = createElement('div', { className: 'modal-footer' });
    const submitBtn = createElement('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Envoyer le commentaire' });
    footer.appendChild(submitBtn);

    form.append(commentGroup, footer);
    body.append(details, form);
    content.append(header, body);
    
    return content;
}

function renderViewCommentModal(movement: StockMovement): HTMLElement {
    const movementToUpdate = stockMovements.find(m => m.id === movement.id);
    if (movementToUpdate && !movementToUpdate.isCommentRead) {
        // Optimistic UI update
        movementToUpdate.isCommentRead = true;
        // Fire-and-forget request to the server
        fetch(`/api/movements/${movement.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isCommentRead: true })
        }).catch(err => {
            console.error('Failed to mark comment as read on server:', err);
            // Optionally revert the optimistic update here
            movementToUpdate.isCommentRead = false; 
        });
    }
    
    const content = createElement('div', { className: 'modal-content' });

    // Header
    const header = createElement('div', { className: 'modal-header' });
    const title = createElement('h2', { textContent: 'Anomalie signalée par l\'agriculteur' });
    const closeBtn = createElement('button', { className: 'modal-close-btn', textContent: '×' });
    closeBtn.onclick = () => {
        closeModal();
        renderApp(); // Re-render to update badge and button style
    };
    header.append(title, closeBtn);

    // Body
    const body = createElement('div', { className: 'modal-body' });
    
    // Movement details
    const details = createElement('div', { className: 'movement-details-box' });
    details.innerHTML = `
        <p><strong>Mouvement du ${formatDate(movement.date)} pour ${getClientNameById(movement.clientId)}</strong></p>
        <p>${movement.product} | Saisie par : ${getUserNameById(movement.recordedByUserId)}</p>
    `;

    // Comment display
    const commentSection = createElement('div', { className: 'comment-display-box' });
    const commentLabel = createElement('strong', { textContent: 'Commentaire de l\'agriculteur :' });
    const commentText = createElement('p', { textContent: movement.farmerComment || 'Aucun commentaire.' });
    commentSection.append(commentLabel, commentText);

    body.append(details, commentSection);
    content.append(header, body);

    return content;
}


function createPanelWithTitle(title: string): HTMLElement {
    const panel = createElement('div', { className: 'content-panel' });
    const header = createElement('div', { className: 'panel-header' });
    const panelTitle = createElement('h2', { textContent: title });
    header.appendChild(panelTitle);
    panel.appendChild(header);
    return panel;
}

function createTable(headers: (string | HTMLElement)[], data: ((string | HTMLElement)[] | HTMLTableRowElement)[]): HTMLTableElement {
    const table = createElement('table', { className: 'data-table' });
    const thead = createElement('thead');
    const tbody = createElement('tbody');
    const headerRow = createElement('tr');
    headers.forEach(text => {
        const th = createElement('th');
        if (typeof text === 'string') {
            th.textContent = text;
        } else {
            th.appendChild(text);
        }
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    data.forEach(rowData => {
        // If the rowData is already a TR element (from dashboard), append it directly
        if (rowData instanceof HTMLTableRowElement) {
            tbody.appendChild(rowData);
            return;
        }

        const row = createElement('tr');
        (rowData as (string | HTMLElement)[]).forEach(cellData => {
            const td = createElement('td');
            if (typeof cellData === 'string') {
                td.textContent = cellData;
            } else {
                td.appendChild(cellData);
            }
            row.appendChild(td);
        });
        tbody.appendChild(row);
    });

    table.append(thead, tbody);
    return table;
}

function createEmptyState(message: string): HTMLElement {
    const container = createElement('div', { className: 'empty-state' });
    const p = createElement('p', { textContent: message });
    container.appendChild(p);
    return container;
}

// --- MAIN APP RENDERING ---
function renderApp() {
    const root = document.getElementById('root');
    if (!root) {
        console.error('Root element not found');
        return;
    }

    if (isAppLoading) {
        root.className = '';
        root.innerHTML = `<div class="loader-overlay"><div class="loader"></div></div>`;
        return;
    }

    // Do not close modal on filter change
    const isModalOpen = !!document.querySelector('.modal-overlay');
    if (!isModalOpen) {
      root.innerHTML = '';
    } else {
      // If a modal is open, we only want to re-render the main content, not the whole page.
      const main = root.querySelector('.main-content');
      const header = root.querySelector('.header');
      const sidebar = root.querySelector('.sidebar');
      if(main) main.remove();
      if(header) header.remove();
      if(sidebar) sidebar.remove();
    }


    if (!currentUser) {
        root.innerHTML = '';
        root.className = 'login-layout';
        root.appendChild(renderLoginPage());
    } else {
        if (!isModalOpen) {
            root.className = 'app-layout';
            const sidebar = renderSidebar();
            const header = renderHeader();
            const mainContent = renderMainContent();
            root.append(sidebar, header, mainContent);
        } else {
            // Re-render main content and header only when filtering
            const newSidebar = renderSidebar();
            const newHeader = renderHeader();
            const newMainContent = renderMainContent();
            
            const modal = root.querySelector('.modal-overlay');
            root.innerHTML = '';
            root.className = 'app-layout';

            root.append(newSidebar, newHeader, newMainContent);
            if (modal) {
                root.appendChild(modal); // Re-attach the modal
            }
        }
    }
}

// --- APP INITIALIZATION ---
async function initializeApp() {
    // --- DATA FETCHING ---
    try {
        const [clientsRes, usersRes, movementsRes] = await Promise.all([
            fetch('/api/clients'),
            fetch('/api/users'),
            fetch('/api/movements')
        ]);

        if (!clientsRes.ok || !usersRes.ok || !movementsRes.ok) {
            throw new Error('Failed to fetch initial data from server.');
        }
        
        clients = await clientsRes.json();
        users = await usersRes.json();
        stockMovements = await movementsRes.json();
        console.log(`${clients.length} clients, ${users.length} users, and ${stockMovements.length} movements loaded from server.`);

    } catch (error) {
        console.error(error);
        isAppLoading = false; // Stop loading on error
        const root = document.getElementById('root');
        if (root) {
            root.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--danger-color);">
                <h2>Erreur de Connexion au Serveur</h2>
                <p>Impossible de charger les données initiales. Assurez-vous que le serveur backend est bien démarré.</p>
                <p>Pour le démarrer, ouvrez un terminal, lancez <code>npm install</code> puis <code>node server.js</code></p>
            </div>`;
        }
        return; // Stop initialization if data can't be loaded
    }

    // --- AUTO LOGIN ---
    // Auto-login must happen after users are fetched
    const rememberedUserJSON = localStorage.getItem('warehouseRememberMe');
    if (rememberedUserJSON) {
        try {
            const { username, role } = JSON.parse(rememberedUserJSON);
            const foundUser = users.find(u => 
                u.username.toLowerCase() === username.toLowerCase() && 
                u.role === role && 
                u.status === 'Active'
            );

            if (foundUser) {
                currentUser = foundUser;
                if (currentUser.role === 'Agriculteur') {
                    currentPage = 'farmer_stock';
                } else if (currentUser.role === 'Réceptionniste') {
                    currentPage = 'receptionist_dashboard';
                } else {
                    currentPage = 'dashboard';
                }
            }
        } catch (e) {
            console.error("Failed to auto-login with remembered user data", e);
            localStorage.removeItem('warehouseRememberMe');
        }
    }

    isAppLoading = false;
    renderApp();
    
    // Add a global click listener to close pop-ups
    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;

        // Close autocomplete suggestions
        const activeAutocomplete = document.querySelector('.autocomplete-suggestions.active');
        if (activeAutocomplete && !target.closest('.product-autocomplete-group')) {
            activeAutocomplete.classList.remove('active');
        }

        // Close multiselect dropdowns
        const activeMultiselect = document.querySelector('.multiselect-container.active');
        if (activeMultiselect && !target.closest('.multiselect-container')) {
            activeMultiselect.classList.remove('active');
        }
    });
}

// Initial app load
document.addEventListener('DOMContentLoaded', () => {
    // Initial render with a loader before fetching data
    const root = document.getElementById('root');
    if (root) {
        root.className = '';
        root.innerHTML = `<div class="loader-overlay"><div class="loader"></div></div>`;
    }
    initializeApp();
});