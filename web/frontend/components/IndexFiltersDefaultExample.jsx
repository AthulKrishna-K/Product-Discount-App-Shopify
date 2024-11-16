import React, { useState, useCallback, useMemo } from 'react';
import {
  IndexTable,
  LegacyCard,
  IndexFilters,
  Text,
  Badge,
  useIndexResourceState,
  useSetIndexFiltersMode,
  IndexFiltersMode,
  ChoiceList,
  RangeSlider,
  Spinner,
  Frame,
  Toast,
  EmptyState,
  Button,
  Modal,
  TextField,
  Thumbnail,
  Pagination,
  Banner,
} from '@shopify/polaris';
import { useQuery, useQueryClient } from 'react-query';
import { useAppQuery, useAuthenticatedFetch } from "../hooks";

const ProductDiscounter = () => {
  const [selected, setSelected] = useState(0);
  const [queryValue, setQueryValue] = useState('');
  const [sortSelected, setSortSelected] = useState(['title-asc']);
  const [statusFilter, setStatusFilter] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]);
  const [priceRange, setPriceRange] = useState([0, 100]);
  const [errorToast, setErrorToast] = useState(null);
  const [successToast, setSuccessToast] = useState(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [pageInfo, setPageInfo] = useState('');
  const { mode, setMode } = useSetIndexFiltersMode(IndexFiltersMode.Default);
  const fetch = useAuthenticatedFetch();
  const queryClient = useQueryClient();

  const fetchProducts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      
      if (queryValue) params.append('query', queryValue);
      if (statusFilter.length) params.append('status', statusFilter.join(','));
      if (vendorFilter.length) params.append('vendor', vendorFilter.join(','));
      if (priceRange[0] > 0) params.append('price_min', priceRange[0]);
      if (priceRange[1] < 100) params.append('price_max', priceRange[1]);
      if (pageInfo) params.append('page_info', pageInfo);
      
      const response = await fetch(`/api/products?${params.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch products');
      }

      if (!data.success) {
        throw new Error(data.message || 'Failed to fetch products');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }, [fetch, queryValue, statusFilter, vendorFilter, priceRange, pageInfo]);

  const { data, isLoading, isFetching, error } = useQuery(
    ['products', queryValue, statusFilter, vendorFilter, priceRange, pageInfo],
    fetchProducts,
    {
      keepPreviousData: true,
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    }
  );

  const isLoadingData = isLoading || isFetching;

  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];
    
    let filtered = [...data.products];
    const [key, direction] = sortSelected[0].split('-');
    
    filtered.sort((a, b) => {
      const valueA = key === 'price' ? a[key] : a[key].toLowerCase();
      const valueB = key === 'price' ? b[key] : b[key].toLowerCase();
      
      return direction === 'asc' 
        ? valueA > valueB ? 1 : -1
        : valueA < valueB ? 1 : -1;
    });
    
    return filtered;
  }, [data?.products, sortSelected]);

  const vendors = useMemo(() => 
    data?.products ? [...new Set(data.products.map(product => product.vendor))] : [],
    [data?.products]
  );

  const resourceName = {
    singular: 'product',
    plural: 'products',
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredProducts);

  const onHandleCancel = () => {
    setQueryValue('');
    setStatusFilter([]);
    setVendorFilter([]);
    setPriceRange([0, 100]);
    setPageInfo('');
  };

  const handlePaginationChange = useCallback((newPageInfo) => {
    setPageInfo(newPageInfo);
    handleSelectionChange([]);
    window.scrollTo(0, 0);
  }, [handleSelectionChange]);

  const filters = [
    {
      key: 'status',
      label: 'Status',
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: 'Active', value: 'active' },
            { label: 'Draft', value: 'draft' },
            { label: 'Archived', value: 'archived' },
          ]}
          selected={statusFilter}
          onChange={setStatusFilter}
          allowMultiple
        />
      ),
    },
    {
      key: 'vendor',
      label: 'Vendor',
      filter: (
        <ChoiceList
          title="Vendor"
          titleHidden
          choices={vendors.map(vendor => ({ label: vendor, value: vendor }))}
          selected={vendorFilter}
          onChange={setVendorFilter}
          allowMultiple
        />
      ),
    },
    {
      key: 'price',
      label: 'Price range',
      filter: (
        <RangeSlider
          label="Price range"
          value={priceRange}
          onChange={setPriceRange}
          output
          min={0}
          max={100}
        />
      ),
    },
  ];

  const tabs = [
    {
      id: 'all-products',
      content: 'All products',
      accessibilityLabel: 'All products',
      panelID: 'all-products-content',
    },
  ];

  const handleDiscountApply = async () => {
    const discount = parseFloat(discountPercentage);
    if (isNaN(discount) || discount <= 0 || discount > 100) {
      setErrorToast('Please enter a valid discount percentage between 0 and 100');
      return;
    }

    try {
      const selectedProductIds = selectedResources;
      const response = await fetch('/api/apply-discount', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productIds: selectedProductIds,
          discountPercentage: discount,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to apply discount');
      }

      const result = await response.json();
      
      queryClient.setQueryData(['products', queryValue, statusFilter, vendorFilter, priceRange], 
        (oldData) => {
          if (!oldData) return oldData;
          
          return oldData.map(product => {
            const updatedProduct = result.products.find(p => p.id === product.id);
            if (updatedProduct) {
              return {
                ...product,
                price: updatedProduct.compareAtPrice, 
                discountedPrice: updatedProduct.price, 
                discountRate: updatedProduct.discountRate 
              };
            }
            return product;
          });
        }
      );

      setSuccessToast(`Applied ${discount}% discount to ${selectedProductIds.length} product(s)`);
      setDiscountModalOpen(false);
      setDiscountPercentage('');
      

      
      queryClient.invalidateQueries(['products']);
    } catch (error) {
      setErrorToast(error.message || 'Failed to apply discount');
    }
  };

  const rowMarkup = filteredProducts.map(
    ({ id, title, status, vendor, price, discountedPrice, discountRate, image }, index) => (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ flexShrink: 0 }}>
              <Thumbnail
                source={image || '/api/placeholder/50/50'}
                alt={title}
                size="small"
              />
            </div>
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {title}
            </Text>
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge status={status === 'active' ? 'success' : 'warning'}>
            {status}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{vendor}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            ${price}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {discountedPrice ? (
            <div>
              <Text variant="bodyMd" as="span" color="success">
                ${discountedPrice.toFixed(2)}
              </Text>
              <Text variant="bodySm" as="span" color="subdued">
                {' '}(-{discountRate}%)
              </Text>
            </div>
          ) : (
            <Text variant="bodyMd" color="subdued">No discount</Text>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  return (
    <Frame>
      <div className="products-table-container" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          {selectedResources.length > 0 && (
            <Button
              primary
              onClick={() => setDiscountModalOpen(true)}
              disabled={isLoadingData}
            >
              Apply Discount to Selected ({selectedResources.length})
            </Button>
          )}
        </div>
        
        
        <LegacyCard>
          <IndexFilters
            tabs={tabs}
            selected={selected}
            onSelect={setSelected}
            queryValue={queryValue}
            queryPlaceholder="Search products"
            onQueryChange={setQueryValue}
            onQueryClear={() => setQueryValue('')}
            cancelAction={{
              onAction: onHandleCancel,
              disabled: isLoadingData,
              loading: isLoadingData,
            }}
            filters={filters}
            appliedFilters={[]}
            mode={mode}
            setMode={setMode}
            disabled={isLoadingData}
          />
          
          <div className="table-wrapper" style={{ maxWidth: 'none', width: '100%' }}>
            {isLoadingData && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(255, 255, 255, 0.75)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 100,
              }}>
                <Spinner size="large" />
              </div>
            )}

            {error && (
              <div style={{ padding: "1rem", color: "var(--p-text-critical)" }}>
                Error loading products: {error.message}
              </div>
            )}
            
            {!error && data?.products && (
              <>
                <IndexTable
                  resourceName={resourceName}
                  itemCount={filteredProducts.length}
                  selectedItemsCount={
                    allResourcesSelected ? 'All' : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  headings={[
                    { title: 'Product' },
                    { title: 'Status' },
                    { title: 'Vendor' },
                    { title: 'Original Price' },
                    { title: 'Discounted Price' },
                  ]}
                  loading={isLoadingData}
                >
                  {filteredProducts.length > 0 ? rowMarkup : (
                    <IndexTable.Row>
                      <IndexTable.Cell colSpan={5}>
                        <EmptyState
                          heading="No products found"
                          image=""
                        >
                          <p>Try changing your search or filter criteria</p>
                        </EmptyState>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  )}
                </IndexTable>

                {(data.pagination?.has_next || data.pagination?.has_previous) && (
                  <div style={{ padding: '1rem', display: 'flex', justifyContent: 'center' }}>
                    <Pagination
                      hasPrevious={data.pagination.has_previous}
                      onPrevious={() => handlePaginationChange(data.pagination.previous_page_info)}
                      hasNext={data.pagination.has_next}
                      onNext={() => handlePaginationChange(data.pagination.next_page_info)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </LegacyCard>
      </div>
      <Modal
        open={discountModalOpen}
        onClose={() => setDiscountModalOpen(false)}
        title="Apply Discount"
        primaryAction={{
          content: 'Apply Discount',
          onAction: handleDiscountApply,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setDiscountModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <TextField
            label="Discount Percentage"
            type="number"
            value={discountPercentage}
            onChange={setDiscountPercentage}
            autoComplete="off"
            min="0"
            max="100"
            suffix="%"
            helpText="Enter a percentage between 0 and 100"
          />
        </Modal.Section>
      </Modal>
      
      {errorToast && (
        <Toast
          content={errorToast}
          error
          onDismiss={() => setErrorToast(null)}
        />
      )}
      
      {successToast && (
        <Toast
          content={successToast}
          onDismiss={() => setSuccessToast(null)}
        />
      )}
    </Frame>
  );
};

export default ProductDiscounter;