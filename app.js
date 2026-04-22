const { createClient } = supabase;
const _supabase = createClient(CONFIG.SB_URL, CONFIG.SB_KEY);

let currentEditingRecipeId = null;
let isSignUpMode = false;

// --- 1. SYSTEM AUTH ---

async function checkUser() {
    try {
        const { data: { user }, error } = await _supabase.auth.getUser();
        if (error) throw error;

        const authOverlay = document.getElementById('auth-container');
        const appContent = document.getElementById('app-content');

        if (user) {
            authOverlay.style.display = 'none';
            appContent.style.display = 'block';
            document.getElementById('user-email-display').innerText = `Użytkownik: ${user.email}`;
            refreshData();
        } else {
            authOverlay.style.display = 'flex';
            appContent.style.display = 'none';
        }
    } catch (err) {
        console.log("Brak aktywnej sesji.");
        document.getElementById('auth-container').style.display = 'flex';
    }
}

/** Obsługa logowania i rejestracji przez formularz */
window.handleAuthSubmit = async (event) => {
    event.preventDefault();
    const btn = document.getElementById('btn-auth-submit');
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-password').value;
    const retypeField = document.getElementById('auth-retype');

    btn.disabled = true;
    btn.innerText = "Przetwarzanie...";

    try {
        if (isSignUpMode) {
            const retype = retypeField.value;
            if (pass !== retype) throw new Error("Hasła nie są identyczne!");
            
            const { data, error } = await _supabase.auth.signUp({ email, password: pass });
            if (error) throw error;
            
            alert("Konto utworzone! Możesz się teraz zalogować.");
            toggleAuthMode(false);
        } else {
            const { data, error } = await _supabase.auth.signInWithPassword({ email, password: pass });
            if (error) throw error;
            await checkUser();
        }
    } catch (err) {
        console.error("Błąd Auth:", err);
        alert("Błąd: " + (err.message || "Nieznany problem z logowaniem"));
    } finally {
        btn.disabled = false;
        btn.innerText = isSignUpMode ? 'Zarejestruj mnie' : 'Zaloguj się';
    }
};

window.toggleAuthMode = (isSignUp) => {
    isSignUpMode = isSignUp; // Aktualizacja zmiennej globalnej
    document.getElementById('auth-title').innerText = isSignUp ? 'Rejestracja' : 'Logowanie';
    document.getElementById('retype-wrapper').style.display = isSignUp ? 'block' : 'none';
    document.getElementById('btn-auth-submit').innerText = isSignUp ? 'Zarejestruj mnie' : 'Zaloguj się';
    
    document.getElementById('switch-area').innerHTML = isSignUp 
        ? `Masz już konto? <a href="#" onclick="toggleAuthMode(false)">Zaloguj się</a>`
        : `Nie masz konta? <a href="#" onclick="toggleAuthMode(true)">Zarejestruj się</a>`;
};

window.handleSignOut = async () => {
    await _supabase.auth.signOut();
    location.reload(); 
};

window.togglePasswordVisibility = (id) => {
    const el = document.getElementById(id);
    if (el) el.type = el.type === 'password' ? 'text' : 'password';
};

// --- 2. LISTA ZAKUPÓW ---

async function refreshData() {
    const { data: shopping } = await _supabase.from('shopping_list').select('*, products(name)').order('added_at', { ascending: false });
    const { data: recipes } = await _supabase.from('recipes').select('*').order('title');
    renderShoppingList(shopping || []);
    renderRecipesMenu(recipes || []);
    updateAutocompletes();
}

function renderShoppingList(list) {
    document.getElementById('shopping-list').innerHTML = list.map(item => `
        <li class="shopping-item">
            <span onclick="toggleItem('${item.id}', ${item.is_bought})" class="item-text ${item.is_bought ? 'bought' : ''}">
                ${item.is_bought ? '✅' : '⬜'} <strong>${item.products?.name || 'Produkt'}</strong> ${item.amount || ''} ${item.unit || ''}
            </span>
            <button onclick="removeItem('${item.id}')" class="del-btn">&times;</button>
        </li>
    `).join('');
}

window.addItemManually = async () => {
    const name = document.getElementById('new-item-name').value;
    if (!name) return;
    const amount = document.getElementById('new-item-amount').value;
    const unit = document.getElementById('new-item-unit').value;
    
    const productId = await getOrCreateProductId(name);
    const { data: { user } } = await _supabase.auth.getUser();
    
    await _supabase.from('shopping_list').insert([{ 
        product_id: productId, amount, unit, user_id: user.id 
    }]);
    
    document.getElementById('new-item-name').value = "";
    document.getElementById('new-item-amount').value = "";
    document.getElementById('new-item-unit').value = "";
    refreshData();
};

async function getOrCreateProductId(name) {
    let { data: p } = await _supabase.from('products').select('id').ilike('name', name).maybeSingle();
    if (!p) {
        const { data: np } = await _supabase.from('products').insert([{ name }]).select().single();
        return np.id;
    }
    return p.id;
}

// --- 3. PRZEPISY ---

function renderRecipesMenu(list) {
    document.getElementById('recipes-menu').innerHTML = list.map(r => `
        <div class="recipe-item-row">
            <button class="recipe-select-btn" onclick="displayRecipeCard('${r.id}')">📖 ${r.title}</button>
            <button class="recipe-del-btn" onclick="deleteFullRecipe('${r.id}')">🗑️</button>
        </div>
    `).join('');
}

window.displayRecipeCard = async (id) => {
    const { data: r } = await _supabase.from('recipes').select('*').eq('id', id).single();
    const { data: ings } = await _supabase.from('recipe_ingredients').select('*, products(name)').eq('recipe_id', id);
    
    const card = document.getElementById('active-recipe-card');
    document.getElementById('recipes-menu').style.display = 'none';
    card.style.display = 'block';

    card.innerHTML = `
        <div class="recipe-card-modern">
            <div class="card-nav">
                <button onclick="closeRecipeCard()" class="btn-back">← Powrót</button>
                <button onclick="openRecipeEditor('${r.id}')" class="btn-edit-icon">✏️ Edytuj</button>
            </div>
            <h2 class="card-title">${r.title}</h2>
            <div class="card-stats">
                <div>⏱️ ${r.prep_time || '--'}</div>
                <div>🔥 ${r.bake_time || '--'}</div>
                <div>🍴 ${r.servings || '--'} os.</div>
                <div>🍎 ${r.kcal || '--'} kcal</div>
            </div>
            <div class="card-section">
                <div class="section-header" onclick="toggleCardSection('desc-content')">
                    <h3>Sposób przygotowania ▼</h3>
                </div>
                <div id="desc-content" class="section-content" style="display:none; padding:10px; background:#f9f9f9; border-radius:10px;">
                    <p>${r.instructions || 'Brak opisu.'}</p>
                </div>
            </div>
            <div class="card-section">
                <div class="section-header" onclick="toggleCardSection('ings-content')">
                    <h3>Składniki ▼</h3>
                </div>
                <div id="ings-content" class="section-content">
                    <ul class="modern-ing-list">
                        ${ings.map(i => `
                            <li>
                                <label><input type="checkbox" class="ing-to-buy" data-pid="${i.product_id}" data-amt="${i.amount || ''}" data-unt="${i.unit || ''}" checked>
                                ${i.products?.name} (${i.amount || ''} ${i.unit || ''})</label>
                            </li>`).join('')}
                    </ul>
                </div>
            </div>
            <button onclick="addSelectedToCart()" class="btn-add-to-cart">Dodaj do listy 🛒</button>
        </div>
    `;
};

window.openRecipeEditor = async (id = null) => {
    currentEditingRecipeId = id;
    const fields = ['edit-recipe-name', 'edit-recipe-prep', 'edit-recipe-bake', 'edit-recipe-servings', 'edit-recipe-kcal', 'edit-recipe-instructions', 'edit-recipe-url'];
    if (id) {
        const { data: r } = await _supabase.from('recipes').select('*').eq('id', id).single();
        fields.forEach(f => {
            const el = document.getElementById(f);
            if (el) {
                const key = f.replace('edit-recipe-', '');
                el.value = r[key] || "";
            }
        });
        loadEditorIngredients(id);
    } else {
        fields.forEach(f => {
            const el = document.getElementById(f);
            if (el) el.value = "";
        });
        document.getElementById('editor-ingredients-list').innerHTML = "";
    }
    showView('editor');
};

window.saveRecipeData = async (silent = false) => {
    const { data: { user } } = await _supabase.auth.getUser();
    const d = {
        title: document.getElementById('edit-recipe-name').value || "Nowy Przepis",
        prep_time: document.getElementById('edit-recipe-prep').value,
        bake_time: document.getElementById('edit-recipe-bake').value,
        servings: document.getElementById('edit-recipe-servings').value,
        kcal: document.getElementById('edit-recipe-kcal').value,
        instructions: document.getElementById('edit-recipe-instructions').value,
        user_id: user.id
    };
    if (currentEditingRecipeId) {
        await _supabase.from('recipes').update(d).eq('id', currentEditingRecipeId);
    } else {
        const { data } = await _supabase.from('recipes').insert([d]).select().single();
        if (data) currentEditingRecipeId = data.id;
    }
    if (!silent) alert("Zapisano!");
    refreshData();
};

window.addIngredientToRecipe = async () => {
    const name = document.getElementById('ing-name').value;
    if (!name) return;
    if (!currentEditingRecipeId) await saveRecipeData(true);
    const productId = await getOrCreateProductId(name);
    await _supabase.from('recipe_ingredients').insert([{ 
        recipe_id: currentEditingRecipeId, product_id: productId, 
        amount: document.getElementById('ing-amount').value, 
        unit: document.getElementById('ing-unit').value 
    }]);
    document.getElementById('ing-name').value = "";
    loadEditorIngredients(currentEditingRecipeId);
};

// --- 4. FUNKCJE POMOCNICZE UI ---

async function loadEditorIngredients(rid) {
    const { data: ings } = await _supabase.from('recipe_ingredients').select('*, products(name)').eq('recipe_id', rid);
    document.getElementById('editor-ingredients-list').innerHTML = (ings || []).map(i => `
        <li>
            <span>${i.products?.name} (${i.amount || ''} ${i.unit || ''})</span>
            <button onclick="deleteIngFromRecipe('${i.id}')" class="del-btn">✕</button>
        </li>`).join('');
}

window.addSelectedToCart = async () => {
    const { data: { user } } = await _supabase.auth.getUser();
    const sel = document.querySelectorAll('.ing-to-buy:checked');
    const items = Array.from(sel).map(cb => ({ 
        product_id: cb.dataset.pid, amount: cb.dataset.amt, unit: cb.dataset.unt, user_id: user.id 
    }));
    if(items.length > 0) { 
        await _supabase.from('shopping_list').insert(items); 
        alert("Dodano do listy!"); 
        refreshData(); 
        closeRecipeCard(); 
    }
};

window.updateAutocompletes = async () => {
    const { data: products } = await _supabase.from('products').select('name');
    const pList = document.getElementById('products-datalist');
    if (pList) pList.innerHTML = (products || []).map(p => `<option value="${p.name}">`).join('');
    
    const units = ['g', 'kg', 'ml', 'l', 'szt', 'opak.', 'łyżka', 'łyżeczka', 'szklanka'];
    const uList = document.getElementById('units-datalist');
    if (uList) uList.innerHTML = units.map(u => `<option value="${u}">`).join('');
};

window.showView = (v) => {
    document.getElementById('view-main').style.display = v === 'main' ? 'block' : 'none';
    document.getElementById('view-editor').style.display = v === 'editor' ? 'block' : 'none';
};

window.toggleCardSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window.closeRecipeCard = () => { 
    document.getElementById('active-recipe-card').style.display = 'none'; 
    document.getElementById('recipes-menu').style.display = 'block'; 
};

window.deleteFullRecipe = async (id) => { 
    if(confirm("Usunąć przepis?")) { 
        await _supabase.from('recipes').delete().eq('id', id); 
        refreshData(); 
    } 
};

window.deleteIngFromRecipe = async (id) => { 
    await _supabase.from('recipe_ingredients').delete().eq('id', id); 
    loadEditorIngredients(currentEditingRecipeId); 
};

window.toggleItem = async (id, s) => { 
    await _supabase.from('shopping_list').update({ is_bought: !s }).eq('id', id); 
    refreshData(); 
};

window.removeItem = async (id) => { 
    await _supabase.from('shopping_list').delete().eq('id', id); 
    refreshData(); 
};

window.clearBought = async () => { 
    await _supabase.from('shopping_list').delete().eq('is_bought', true); 
    refreshData(); 
};

window.clearAllShopping = async () => { 
    if(confirm("Wyczyścić całą listę?")) { 
        const { data: { user } } = await _supabase.auth.getUser();
        await _supabase.from('shopping_list').delete().eq('user_id', user.id); 
        refreshData(); 
    } 
};

// Inicjalizacja
checkUser();