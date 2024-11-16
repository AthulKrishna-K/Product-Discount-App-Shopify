<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use Exception;
use Illuminate\Support\Facades\Log;
use App\Http\Controllers\Controller;

class ProductController extends Controller
{
    private const PER_PAGE = 20;

    private function createClient($shop, $accessToken)
    {
        return new Client([
            'base_uri' => "https://{$shop}/admin/api/2023-04/",
            'headers' => [
                'Content-Type' => 'application/json',
                'X-Shopify-Access-Token' => $accessToken,
            ],
            'http_errors' => false,
        ]);
    }

    public function index(Request $request)
    {
        try {
            $session = $request->get('shopifySession');
            if (!$session) {
                throw new Exception('No Shopify session found');
            }

            $domain = $session->getShop();
            $accessToken = $session->getAccessToken();

            if (!$domain || !$accessToken) {
                throw new Exception('Invalid session data');
            }

            $client = $this->createClient($domain, $accessToken);
            
            $pageInfo = $request->get('page_info');
            
            $queryParams = array_filter([
                'status' => $request->get('status'),
                'vendor' => $request->get('vendor'),
                'price_min' => $request->get('price_min'),
                'price_max' => $request->get('price_max'),
                'title' => $request->get('query'),
                'limit' => self::PER_PAGE,
                'fields' => 'id,title,status,vendor,variants,images',
                'page_info' => $pageInfo
            ]);

            
            $response = $client->get('products.json', [
                'query' => $queryParams
            ]);

            $statusCode = $response->getStatusCode();
            $responseData = json_decode($response->getBody(), true);

            if ($statusCode !== 200) {
                throw new Exception($this->formatErrorMessage($responseData['errors'] ?? 'Shopify API error'));
            }

            if (!isset($responseData['products']) || !is_array($responseData['products'])) {
                throw new Exception('Invalid response format from Shopify');
            }

            
            $linkHeader = $response->getHeader('Link');
            $paginationInfo = $this->parseLinkHeader($linkHeader);

            $transformedProducts = array_map(function ($product) {
                $variant = $product['variants'][0] ?? null;
                $price = $variant ? floatval($variant['price']) : 0;
                $compareAtPrice = $variant ? floatval($variant['compare_at_price'] ?? 0) : 0;
                
                $discountInfo = $this->calculateDiscountInfo($price, $compareAtPrice);

                $image = null;
                if (!empty($product['images'])) {
                    $firstImage = $product['images'][0];
                    $image = $firstImage['src'];
                }

                return [
                    'id' => (string)$product['id'],
                    'title' => $product['title'],
                    'status' => $product['status'],
                    'vendor' => $product['vendor'],
                    'price' => $discountInfo['price'],
                    'discountedPrice' => $discountInfo['discountedPrice'],
                    'discountRate' => $discountInfo['discountRate'],
                    'image' => $image
                ];
            }, $responseData['products']);

            return response()->json([
                'success' => true,
                'products' => $transformedProducts,
                'pagination' => [
                    'previous_page_info' => $paginationInfo['previous'] ?? null,
                    'next_page_info' => $paginationInfo['next'] ?? null,
                    'has_previous' => isset($paginationInfo['previous']),
                    'has_next' => isset($paginationInfo['next'])
                ]
            ]);

        } catch (GuzzleException $e) {
            Log::error('Shopify API Error', [
                'message' => $e->getMessage(),
                'code' => $e->getCode()
            ]);

            return response()->json([
                'success' => false,
                'error' => 'Failed to communicate with Shopify',
                'message' => $e->getMessage()
            ], 500);

        } catch (Exception $e) {
            Log::error('Products Controller Error', [
                'message' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'error' => 'Failed to fetch products',
                'message' => $e->getMessage()
            ], 500);
        }
    }
    private function parseLinkHeader($linkHeader)
    {
        if (empty($linkHeader)) {
            return [];
        }

        $links = [];
        $linkParts = explode(',', $linkHeader[0]);

        foreach ($linkParts as $link) {
            if (preg_match('/<(.+)>;\s*rel="([^"]+)"/', $link, $matches)) {
                $url = parse_url($matches[1]);
                parse_str($url['query'] ?? '', $queryParams);
                $links[$matches[2]] = $queryParams['page_info'] ?? null;
            }
        }

        return $links;
    }

    private function formatErrorMessage($errors) {
        if (is_string($errors)) {
            return $errors;
        }
        if (is_array($errors)) {
            return implode('. ', array_map(function($error) {
                return is_array($error) ? implode('. ', $error) : $error;
            }, $errors));
        }
        return 'An unknown error occurred';
    }

    private function calculateDiscountInfo($price, $compareAtPrice): array
    {
        $discountedPrice = null;
        $discountRate = null;

        if ($compareAtPrice > 0 && $price > 0 && $compareAtPrice > $price) {
            $discountedPrice = $price;
            $discountRate = round((($compareAtPrice - $price) / $compareAtPrice) * 100, 1);
        }

        return [
            'price' => $compareAtPrice ?: $price,
            'discountedPrice' => $discountedPrice,
            'discountRate' => $discountRate
        ];
    }

    public function applyDiscount(Request $request)
    {
        try {
           
            $request->validate([
                'productIds' => 'required|array',
                'productIds.*' => 'required|string',
                'discountPercentage' => 'required|numeric|min:0|max:100'
            ]);

           
            $session = $request->get('shopifySession');
            if (!$session) {
                throw new Exception('No Shopify session found');
            }

            $domain = $session->getShop();
            $accessToken = $session->getAccessToken();

            if (!$domain || !$accessToken) {
                throw new Exception('Invalid session data');
            }

            
            $client = $this->createClient($domain, $accessToken);
            $discountMultiplier = (100 - $request->discountPercentage) / 100;
            $processedProducts = [];
            $failedProducts = [];

            
            foreach ($request->productIds as $productId) {
                try {
                    
                    $response = $client->get("products/{$productId}.json");
                    $productData = json_decode($response->getBody(), true);
                    
                    if ($response->getStatusCode() !== 200) {
                        $failedProducts[] = [
                            'id' => $productId,
                            'error' => $productData['errors'] ?? 'Failed to fetch product'
                        ];
                        continue;
                    }

                    $product = $productData['product'];
                    $lastUpdatedVariant = null;
                    
                    
                    foreach ($product['variants'] as $variant) {
                        $originalPrice = floatval($variant['price']);
                        $compareAtPrice = $originalPrice; 
                        $discountedPrice = number_format($originalPrice * $discountMultiplier, 2, '.', '');
                        
                        
                        $updateResponse = $client->put("variants/{$variant['id']}.json", [
                            'json' => [
                                'variant' => [
                                    'id' => $variant['id'],
                                    'price' => $discountedPrice,
                                    'compare_at_price' => $compareAtPrice
                                ]
                            ]
                        ]);
                        
                        if ($updateResponse->getStatusCode() !== 200) {
                            throw new Exception('Failed to update variant prices');
                        }

                        $lastUpdatedVariant = [
                            'price' => floatval($discountedPrice),
                            'compareAtPrice' => floatval($compareAtPrice)
                        ];
                    }

                    if ($lastUpdatedVariant) {
                        $discountInfo = $this->calculateDiscountInfo(
                            $lastUpdatedVariant['price'],
                            $lastUpdatedVariant['compareAtPrice']
                        );

                        $processedProducts[] = [
                            'id' => $productId,
                            'title' => $product['title'],
                            'price' => $discountInfo['price'],
                            'discountedPrice' => $discountInfo['discountedPrice'],
                            'discountRate' => $discountInfo['discountRate']
                        ];
                    }

                } catch (Exception $e) {
                    $failedProducts[] = [
                        'id' => $productId,
                        'error' => $e->getMessage()
                    ];
                    continue;
                }
            }

            return response()->json([
                'success' => true,
                'message' => sprintf(
                    "Successfully applied discount to %d products",
                    count($processedProducts)
                ),
                'products' => $processedProducts,
                'failedProducts' => $failedProducts
            ]);

        } catch (Exception $e) {
            Log::error('Discount Application Error', [
                'message' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'error' => 'Failed to apply discounts',
                'message' => $e->getMessage()
            ], 500);
        }
    }
}