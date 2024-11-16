<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ProductController;

Route::get('/products', [ProductController::class, 'index'])->name('products.index')->middleware(['shopify.auth']);
Route::post('/apply-discount', [ProductController::class, 'applyDiscount'])->name('products.discount')->middleware(['shopify.auth']);;
